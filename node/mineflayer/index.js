const fs = require('fs')
const http = require('http')
const path = require('path')
const { EventEmitter } = require('events')

const compression = require('compression')
const express = require('express')
const wsServerModule = require('mcraft-fun-mineflayer/build/wsServer')

const DEFAULT_PORT = 3000
const DEFAULT_VIEW_DISTANCE = 6
const DIST_DIR = path.resolve(__dirname, '..', '..', 'dist')
const INDEX_FILE = path.join(DIST_DIR, 'index.html')
const VIEWER_BOOTSTRAP_CONFIG_PATH = '/__minecraft-web-client-viewer-config'
const DIST_ASSET_DIR_NAMES = ['background', 'static', 'textures']
let distRootAssetFileNames

const PROTOCOL_ANGLE_PACKET_FIELDS = {
  spawn_entity: ['pitch', 'yaw', 'headPitch'],
  named_entity_spawn: ['yaw', 'pitch'],
  spawn_entity_living: ['yaw', 'pitch', 'headPitch'],
  entity_look: ['yaw', 'pitch'],
  entity_move_look: ['yaw', 'pitch'],
  entity_teleport: ['yaw', 'pitch'],
  entity_head_rotation: ['headYaw']
}

function encodeProtocolAngleByte (degrees) {
  const normalizedDegrees = ((degrees % 360) + 360) % 360
  const unsignedByte = Math.floor(normalizedDegrees * 256 / 360) & 0xff
  return unsignedByte > 127 ? unsignedByte - 256 : unsignedByte
}

function normalizeProtocolAnglePacket (name, data) {
  const angleFields = PROTOCOL_ANGLE_PACKET_FIELDS[name]
  if (!angleFields || !data) return data

  let normalizedData
  for (const field of angleFields) {
    const value = data[field]
    if (typeof value !== 'number') continue
    if (Number.isInteger(value) && value >= -128 && value <= 127) continue

    normalizedData ??= { ...data }
    normalizedData[field] = encodeProtocolAngleByte(value)
  }

  return normalizedData ?? data
}

function patchMcraftEntityReplicatorAngleWrites () {
  const entityReplicatorModule = require('mcraft-fun-mineflayer/build/replicator/entity')
  if (entityReplicatorModule.__minecraftWebClientAnglePatch) return

  const originalEntityReplicator = entityReplicatorModule.entityReplicator
  entityReplicatorModule.entityReplicator = (bot) => {
    const replicator = originalEntityReplicator(bot)
    const originalOnClientJoin = replicator.onClientJoin

    return {
      ...replicator,
      onClientJoin (client) {
        const originalWriteMethod = client.write
        const originalWrite = originalWriteMethod.bind(client)
        client.write = (name, data) => {
          return originalWrite(name, normalizeProtocolAnglePacket(name, data))
        }

        try {
          return originalOnClientJoin.call(replicator, client)
        } finally {
          client.write = originalWriteMethod
        }
      }
    }
  }

  entityReplicatorModule.__minecraftWebClientAnglePatch = true
}

patchMcraftEntityReplicatorAngleWrites()
const { createMineflayerPluginServer } = require('mcraft-fun-mineflayer/build/server')

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

function buildViewerBootstrapPayload (settings) {
  return {
    viewerViewDistance: String(settings.viewDistance),
    viewerCamera: settings.firstPerson ? 'first_person' : 'birdseye',
    viewerReadOnly: '1',
  }
}

function isViewerBootstrapConfigPath (reqPath) {
  return reqPath === VIEWER_BOOTSTRAP_CONFIG_PATH || reqPath.endsWith(VIEWER_BOOTSTRAP_CONFIG_PATH)
}

function getSafeDistFilePath (distPath) {
  const filePath = path.resolve(DIST_DIR, distPath)
  if (!filePath.startsWith(`${DIST_DIR}${path.sep}`)) return
  if (!fs.existsSync(filePath)) return
  if (!fs.statSync(filePath).isFile()) return
  return filePath
}

function getDistRootAssetFileNames () {
  distRootAssetFileNames ??= new Set(fs.readdirSync(DIST_DIR)
    .filter(fileName => fs.statSync(path.join(DIST_DIR, fileName)).isFile()))
  return distRootAssetFileNames
}

function getDistAssetPathFromProxyPath (reqPath) {
  for (const dirName of DIST_ASSET_DIR_NAMES) {
    const marker = `/${dirName}/`
    const markerIndex = reqPath.indexOf(marker)
    if (markerIndex !== -1) {
      return getSafeDistFilePath(reqPath.slice(markerIndex + 1))
    }
  }

  const basename = path.posix.basename(reqPath)
  if (getDistRootAssetFileNames().has(basename)) {
    return getSafeDistFilePath(basename)
  }
}

function isBase64WebSocketRequest (req) {
  try {
    return new URL(req.url, 'http://localhost').searchParams.get('transport') === 'base64'
  } catch {
    return false
  }
}

function decodeBase64WebSocketPayload (data, isBinary) {
  if (isBinary) return data

  const text = Buffer.isBuffer(data) ? data.toString() : String(data)
  if (!text.startsWith('base64:')) return data

  return Buffer.from(text.slice('base64:'.length), 'base64')
}

function encodeBase64WebSocketPayload (data) {
  if (typeof data === 'string') return data
  return `base64:${Buffer.from(data).toString('base64')}`
}

function createBase64WebSocketWrapper (webSocket) {
  const wrapper = Object.create(webSocket)

  wrapper.on = (eventName, listener) => {
    if (eventName !== 'message') {
      return webSocket.on(eventName, listener)
    }

    return webSocket.on('message', (data, isBinary) => {
      listener(decodeBase64WebSocketPayload(data, isBinary), isBinary)
    })
  }
  wrapper.send = (data, callback) => {
    return webSocket.send(encodeBase64WebSocketPayload(data), callback)
  }
  wrapper.close = (...args) => webSocket.close(...args)

  return wrapper
}

function addBase64WebSocketTransport (plugin) {
  const wsServer = plugin?._wsServer
  if (!wsServer || wsServer.__minecraftWebClientBase64Transport) return

  const originalNewConnection = wsServer.newConnection.bind(wsServer)

  wsServer.newConnection = (webSocket, req) => {
    const nextWebSocket = isBase64WebSocketRequest(req)
      ? createBase64WebSocketWrapper(webSocket)
      : webSocket
    return originalNewConnection(nextWebSocket, req)
  }
  wsServer.__minecraftWebClientBase64Transport = true
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
    const plugin = createMineflayerPluginServer(bot, {
      websocketEnabled: true,
      websocketPort: settings.port,
      tcpEnabled: false,
      forwardChat: true,
      showConnectionInstructions: false,
      stopServersOnDisconnect: false
    })
    addBase64WebSocketTransport(plugin)
    return plugin
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

  app.get('*', (req, res, next) => {
    if (!isViewerBootstrapConfigPath(req.path)) {
      next()
      return
    }

    res.setHeader('Cache-Control', 'no-store')
    res.json(buildViewerBootstrapPayload(settings))
  })

  app.get(['/', '/index.html'], (_req, res) => {
    res.sendFile(INDEX_FILE)
  })

  app.use(express.static(DIST_DIR))
  app.use((req, res, next) => {
    const assetPath = getDistAssetPathFromProxyPath(req.path)
    if (!assetPath) {
      next()
      return
    }

    res.sendFile(assetPath)
  })
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
    console.log(`Minecraft Web Client viewer running on port: ${settings.port}`)
  })

  return viewer
}

module.exports = {
  mineflayer
}
