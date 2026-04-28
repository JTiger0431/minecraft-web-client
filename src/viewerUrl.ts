export const VIEWER_BOOTSTRAP_CONFIG_PATH = '__minecraft-web-client-viewer-config'
export const VIEWER_WEBSOCKET_PATH = '__minecraft-web-client-ws'

export function getCurrentPageDirectoryUrl (href: string) {
  const url = new URL(href)
  url.hash = ''
  url.search = ''

  if (!url.pathname.endsWith('/')) {
    const lastSegment = url.pathname.slice(url.pathname.lastIndexOf('/') + 1)
    if (lastSegment.includes('.')) {
      url.pathname = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
    } else {
      url.pathname += '/'
    }
  }

  return url
}

export function getViewerBootstrapConfigUrl (href = window.location.href) {
  return new URL(VIEWER_BOOTSTRAP_CONFIG_PATH, getCurrentPageDirectoryUrl(href)).toString()
}

export function getViewerWebSocketUrl (href = window.location.href) {
  const url = new URL(VIEWER_WEBSOCKET_PATH, getCurrentPageDirectoryUrl(href))
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('transport', 'base64')
  return url.toString()
}
