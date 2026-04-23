const fs = require('fs')
const http = require('http')
const path = require('path')
const { EventEmitter } = require('events')

const compression = require('compression')
const express = require('express')
const { createMineflayerPluginServer } = require('mcraft-fun-mineflayer/build/server')
const wsServerModule = require('mcraft-fun-mineflayer/build/wsServer')

const DEFAULT_PORT = 3000
const DEFAULT_VIEW_DISTANCE = 6
const DIST_DIR = path.resolve(__dirname, '..', '..', 'dist')
const INDEX_FILE = path.join(DIST_DIR, 'index.html')
const VIEWER_BOOTSTRAP_CONFIG_PATH = '/__minecraft-web-client-viewer-config'

function assertViewerCanStart (bot, settings) {
  if (settings.prefix) {
    throw new Error('[minecraft-web-client/mineflayer] `prefix` is not supported in v1.')
  }

  if (bot.viewer) {
    throw new Error('[minecraft-web-client/mineflayer] `bot.viewer` is already attached.')
  }

  if (bot.webViewer) {
    throw new Error('[minecraft-web-client/mineflayer] `bot.webViewer` is already attached.')
  }

  if (bot.game?.gameMode !== undefined || bot.entity) {
    throw new Error('[minecraft-web-client/mineflayer] Call mineflayer(bot, options) right after createBot() and before the bot enters the world.')
  }

  if (!fs.existsSync(INDEX_FILE)) {
    throw new Error('[minecraft-web-client/mineflayer] Built web assets were not found. Ensure the package includes `dist/` or run the project build before using this entrypoint.')
  }
}

function buildViewerUrl (req, settings) {
  const forwardedProtocol = req.headers['x-forwarded-proto']
  const httpProtocol = (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol)?.split(',')[0]
    || (req.socket.encrypted ? 'https' : 'http')
  const wsProtocol = httpProtocol === 'https' ? 'wss' : 'ws'
  const host = req.headers.host || `127.0.0.1:${settings.port}`
  const viewerUrl = new URL(`${httpProtocol}://${host}/`)

  viewerUrl.searchParams.set('viewerConnect', `${wsProtocol}://${host}`)
  viewerUrl.searchParams.set('viewerViewDistance', String(settings.viewDistance))
  viewerUrl.searchParams.set('viewerCamera', settings.firstPerson ? 'first_person' : 'birdseye')
  viewerUrl.searchParams.set('viewerReadOnly', '1')

  return viewerUrl.toString()
}

function buildViewerBootstrapPayload (req, settings) {
  const viewerUrl = buildViewerUrl(req, settings)
  const parsedViewerUrl = new URL(viewerUrl)

  return {
    viewerUrl,
    viewerConnect: parsedViewerUrl.searchParams.get('viewerConnect'),
    viewerViewDistance: parsedViewerUrl.searchParams.get('viewerViewDistance'),
    viewerCamera: parsedViewerUrl.searchParams.get('viewerCamera'),
    viewerReadOnly: parsedViewerUrl.searchParams.get('viewerReadOnly'),
  }
}

function createPluginServerOnHttpServer (bot, settings, server) {
  const originalSetNextWebsocketOptions = wsServerModule.setNextWebsocketOptions

  wsServerModule.setNextWebsocketOptions = (options) => {
    if (options === undefined) {
      return originalSetNextWebsocketOptions({ server })
    }

    return originalSetNextWebsocketOptions(options)
  }

  try {
    originalSetNextWebsocketOptions({ server })
    return createMineflayerPluginServer(bot, {
      websocketEnabled: true,
      websocketPort: settings.port,
      tcpEnabled: false,
      forwardChat: true,
      showConnectionInstructions: false,
      stopServersOnDisconnect: false
    })
  } finally {
    wsServerModule.setNextWebsocketOptions = originalSetNextWebsocketOptions
    originalSetNextWebsocketOptions(undefined)
  }
}

function createPrimitiveViewer () {
  const primitives = new Map()
  const viewer = new EventEmitter()
  let plugin
  let detachPlugin = () => {}

  const broadcastPrimitive = (packet) => {
    if (!plugin?._customChannel) return
    plugin._customChannel.send(packet)
  }

  const setPrimitive = (primitive) => {
    primitives.set(primitive.id, primitive)
    broadcastPrimitive({
      type: 'primitive:set',
      primitive
    })
  }

  viewer.drawLine = (id, points, color = 0xff0000) => {
    setPrimitive({
      id,
      type: 'line',
      points,
      color
    })
  }

  viewer.drawPoints = (id, points, color = 0xff0000, size = 5) => {
    setPrimitive({
      id,
      type: 'points',
      points,
      color,
      size
    })
  }

  viewer.drawBoxGrid = (id, start, end, color = 'aqua') => {
    setPrimitive({
      id,
      type: 'boxgrid',
      start,
      end,
      color
    })
  }

  viewer.erase = (id) => {
    if (!primitives.has(id)) return
    primitives.delete(id)
    broadcastPrimitive({
      type: 'primitive:remove',
      id
    })
  }

  return {
    viewer,
    attachPlugin (nextPlugin) {
      detachPlugin()
      plugin = nextPlugin

      const originalReceivedProcessor = plugin._customChannel.receivedProcessor
      plugin._customChannel.receivedProcessor = (packet) => {
        if (packet?.type === 'primitive:sync-request') {
          for (const primitive of primitives.values()) {
            broadcastPrimitive({
              type: 'primitive:set',
              primitive
            })
          }
          return
        }

        originalReceivedProcessor?.(packet)
      }

      detachPlugin = () => {
        plugin._customChannel.receivedProcessor = originalReceivedProcessor
        plugin = undefined
        detachPlugin = () => {}
      }
    },
    detach () {
      detachPlugin()
      primitives.clear()
    }
  }
}

function mineflayer (bot, options = {}) {
  const settings = {
    port: options.port ?? DEFAULT_PORT,
    viewDistance: options.viewDistance ?? DEFAULT_VIEW_DISTANCE,
    firstPerson: options.firstPerson ?? false,
    prefix: options.prefix ?? ''
  }

  assertViewerCanStart(bot, settings)

  const app = express()
  app.set('trust proxy', true)
  app.use(compression())

  app.get(VIEWER_BOOTSTRAP_CONFIG_PATH, (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.json(buildViewerBootstrapPayload(req, settings))
  })

  app.get(['/', '/index.html'], (req, res, next) => {
    if (req.query.viewerConnect) {
      next()
      return
    }

    res.redirect(buildViewerUrl(req, settings))
  })

  app.use(express.static(DIST_DIR))
  app.get('*', (_req, res) => {
    res.sendFile(INDEX_FILE)
  })

  const server = http.createServer(app)

  const { viewer, attachPlugin, detach } = createPrimitiveViewer()
  let plugin

  let closed = false
  const onInjectAllowed = () => {
    if (closed || plugin) return
    if (bot.game?.gameMode !== undefined || bot.entity) {
      throw new Error('[minecraft-web-client/mineflayer] Cannot start the viewer bridge after the bot entered the world.')
    }

    plugin = createPluginServerOnHttpServer(bot, settings, server)
    attachPlugin(plugin)
  }
  const onBotEnd = () => {
    viewer.close()
  }

  viewer.close = () => {
    if (closed) return
    closed = true

    bot.removeListener('end', onBotEnd)
    bot.removeListener('inject_allowed', onInjectAllowed)
    detach()

    plugin?._tcpServer?.close()
    plugin?._wsServer?.close()

    if (server.listening) {
      server.close()
    }
  }

  bot.once('end', onBotEnd)
  bot.viewer = viewer

  if (bot.version && bot.registry) {
    onInjectAllowed()
  } else {
    bot.once('inject_allowed', onInjectAllowed)
  }

  server.on('error', (error) => {
    viewer.close()
    throw error
  })

  server.listen(settings.port, () => {
    console.log(`Minecraft Web Client viewer running on http://127.0.0.1:${settings.port}`)
  })

  return viewer
}

module.exports = {
  mineflayer
}
