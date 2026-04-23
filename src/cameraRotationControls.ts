import { MAX_BIRDSEYE_DISTANCE, MAX_BIRDSEYE_PITCH, MIN_BIRDSEYE_DISTANCE, MIN_BIRDSEYE_PITCH } from 'renderer/viewer/lib/basePlayerState'
import { contro } from './controls'
import { activeModalStack, gameAdditionalState, isGameActive, miscUiState, showModal } from './globalState'
import { options } from './optionsStorage'
import { hideNotification, notificationProxy } from './react/NotificationProvider'
import { pointerLock } from './utils'
import { updateMotion, initMotionTracking } from './react/uiMotion'

let lastMouseMove: number

export type CameraMoveEvent = {
  movementX: number
  movementY: number
  type: string
  stopPropagation?: () => void
}

export function onCameraMove (e: MouseEvent | CameraMoveEvent) {
  if (!isGameActive(true)) return
  if (e.type === 'mousemove' && !document.pointerLockElement) return
  e.stopPropagation?.()
  if (appViewer.playerState.utils.isSpectatingEntity()) return
  const now = performance.now()
  // todo: limit camera movement for now to avoid unexpected jumps
  if (now - lastMouseMove < 4 && !options.preciseMouseInput) return
  lastMouseMove = now
  let { mouseSensX, mouseSensY } = options
  if (mouseSensY === -1) mouseSensY = mouseSensX
  const usedBirdseyeControls = moveCameraRawHandler({
    x: e.movementX * mouseSensX * 0.0001,
    y: e.movementY * mouseSensY * 0.0001
  })
  if (!usedBirdseyeControls) {
    bot.mouse.update()
  }
  updateMotion()
}

export const moveCameraRawHandler = ({ x, y }: { x: number; y: number }) => {
  const maxPitch = 0.5 * Math.PI
  const minPitch = -0.5 * Math.PI

  appViewer.lastCamUpdate = Date.now()

  // if (viewer.world.freeFlyMode) {
  //   // Update freeFlyState directly
  //   viewer.world.freeFlyState.yaw = (viewer.world.freeFlyState.yaw - x) % (2 * Math.PI)
  //   viewer.world.freeFlyState.pitch = Math.max(minPitch, Math.min(maxPitch, viewer.world.freeFlyState.pitch - y))
  //   return
  // }

  if (appViewer.playerState.reactive.perspective === 'birdseye') {
    const nextYaw = appViewer.playerState.reactive.birdseyeYaw - x
    const nextPitch = Math.max(MIN_BIRDSEYE_PITCH, Math.min(MAX_BIRDSEYE_PITCH, appViewer.playerState.reactive.birdseyePitch - y))
    appViewer.playerState.reactive.birdseyeYaw = nextYaw
    appViewer.playerState.reactive.birdseyePitch = nextPitch
    return true
  }

  if (!bot?.entity) return
  const pitch = bot.entity.pitch - y
  void bot.look(bot.entity.yaw - x, Math.max(minPitch, Math.min(maxPitch, pitch)), true)
  appViewer.backend?.updateCamera(null, bot.entity.yaw, pitch)
  return false
}

const isBirdseyePerspective = () => appViewer.playerState.reactive.perspective === 'birdseye'
const isViewerReadOnlySession = () => gameAdditionalState.viewerConnection && gameAdditionalState.viewerReadOnly

const isViewerInteractionTarget = (target: EventTarget | null) => {
  if (target instanceof Element) {
    if (target.closest('input, textarea, select, button, a, [contenteditable="true"]')) return false
    if (target.closest('#chat, .chat, .chat-input-wrapper, .chat-completions')) return false
  }

  if (isViewerReadOnlySession()) return true
  return target instanceof Element && !!target.closest('#viewer-canvas')
}

const applyBirdseyeZoom = (deltaY: number) => {
  if (!isBirdseyePerspective()) return
  const currentDistance = appViewer.playerState.reactive.birdseyeDistance
  const scaledDistance = currentDistance * Math.exp(deltaY * 0.001)
  appViewer.playerState.reactive.birdseyeDistance = Math.max(MIN_BIRDSEYE_DISTANCE, Math.min(MAX_BIRDSEYE_DISTANCE, scaledDistance))
}

const applyBirdseyePan = (deltaX: number, deltaY: number) => {
  if (!isBirdseyePerspective()) return
  const { birdseyeYaw, birdseyeDistance } = appViewer.playerState.reactive
  const viewerCanvas = document.getElementById('viewer-canvas') as HTMLCanvasElement | null
  const viewportHeight = Math.max(1, viewerCanvas?.clientHeight ?? document.documentElement.clientHeight ?? window.innerHeight ?? 1)
  const verticalFovRadians = (appViewer.inWorldRenderingConfig.fov ?? 75) * Math.PI / 180
  const worldUnitsPerPixel = (2 * Math.tan(verticalFovRadians / 2) * birdseyeDistance) / viewportHeight
  const panSpeed = Math.max(0.004, worldUnitsPerPixel)
  const rightX = Math.cos(birdseyeYaw)
  const rightZ = -Math.sin(birdseyeYaw)
  const forwardX = -Math.sin(birdseyeYaw)
  const forwardZ = -Math.cos(birdseyeYaw)

  appViewer.playerState.reactive.birdseyePanX += (-deltaX * rightX + deltaY * forwardX) * panSpeed
  appViewer.playerState.reactive.birdseyePanZ += (-deltaX * rightZ + deltaY * forwardZ) * panSpeed
}

const birdseyeDragState = {
  active: false,
  mode: 'rotate' as 'rotate' | 'pan',
  lastX: 0,
  lastY: 0
}

window.addEventListener('mousemove', (e: MouseEvent) => {
  onCameraMove(e)
}, { capture: true })

window.addEventListener('mousedown', (e: MouseEvent) => {
  if (!isGameActive(true) || !isBirdseyePerspective() || !isViewerInteractionTarget(e.target)) return
  if (e.button !== 0 && e.button !== 1 && e.button !== 2) return

  e.preventDefault()
  birdseyeDragState.active = true
  birdseyeDragState.mode = e.button === 2 || e.shiftKey || e.metaKey || e.ctrlKey ? 'pan' : 'rotate'
  birdseyeDragState.lastX = e.clientX
  birdseyeDragState.lastY = e.clientY
}, { capture: true })

window.addEventListener('mousemove', (e: MouseEvent) => {
  if (!birdseyeDragState.active || !isBirdseyePerspective()) return
  if (document.pointerLockElement) return

  const deltaX = e.clientX - birdseyeDragState.lastX
  const deltaY = e.clientY - birdseyeDragState.lastY
  birdseyeDragState.lastX = e.clientX
  birdseyeDragState.lastY = e.clientY

  if (deltaX === 0 && deltaY === 0) return

  e.preventDefault()
  if (birdseyeDragState.mode === 'pan') {
    applyBirdseyePan(deltaX, deltaY)
  } else {
    onCameraMove({
      movementX: deltaX,
      movementY: deltaY,
      type: 'birdseyeDrag',
      stopPropagation () {}
    })
  }
}, { capture: true })

window.addEventListener('mouseup', () => {
  birdseyeDragState.active = false
}, { capture: true })

window.addEventListener('blur', () => {
  birdseyeDragState.active = false
})

window.addEventListener('wheel', (e: WheelEvent) => {
  if (!isGameActive(true) || !isBirdseyePerspective() || !isViewerInteractionTarget(e.target)) return

  e.preventDefault()
  applyBirdseyeZoom(e.deltaY)
}, { passive: false, capture: true })

export const onControInit = () => {
  contro.on('stickMovement', ({ stick, vector }) => {
    if (!isGameActive(true)) return
    if (stick !== 'right') return
    let { x, z } = vector
    if (Math.abs(x) < 0.18) x = 0
    if (Math.abs(z) < 0.18) z = 0
    onCameraMove({
      movementX: x * 10,
      movementY: z * 10,
      type: 'stickMovement',
      stopPropagation () {}
    } as CameraMoveEvent)
    miscUiState.usingGamepadInput = true
  })
}

function pointerLockChangeCallback () {
  if (appViewer.rendererState.preventEscapeMenu) return
  if (!pointerLock.hasPointerLock && activeModalStack.length === 0 && miscUiState.gameLoaded) {
    showModal({ reactType: 'pause-screen' })
  }
}

document.addEventListener('pointerlockchange', pointerLockChangeCallback, false)
