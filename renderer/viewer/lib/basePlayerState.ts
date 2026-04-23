import { ItemSelector } from 'mc-assets/dist/itemDefinitions'
import { GameMode, Team } from 'mineflayer'
import { proxy } from 'valtio'
import type { HandItemBlock } from '../three/holdingBlock'

export type MovementState = 'NOT_MOVING' | 'WALKING' | 'SPRINTING' | 'SNEAKING'
export type ItemSpecificContextProperties = Partial<Pick<ItemSelector['properties'], 'minecraft:using_item' | 'minecraft:use_duration' | 'minecraft:use_cycle' | 'minecraft:display_context'>>
export type CameraPerspective = 'first_person' | 'third_person_back' | 'third_person_front' | 'birdseye'

export const DEFAULT_BIRDSEYE_DISTANCE = Math.hypot(18, 6)
export const DEFAULT_BIRDSEYE_PITCH = Math.atan2(18, 6)
export const MIN_BIRDSEYE_DISTANCE = 4
export const MAX_BIRDSEYE_DISTANCE = 96
export const MIN_BIRDSEYE_PITCH = 0.15
export const MAX_BIRDSEYE_PITCH = Math.PI / 2 - 0.05

export type BlockShape = { position: any; width: any; height: any; depth: any; }
export type BlocksShapes = BlockShape[]

// edit src/mineflayer/playerState.ts for implementation of player state from mineflayer
export const getInitialPlayerState = () => proxy({
  playerSkin: undefined as string | undefined,
  inWater: false,
  waterBreathing: false,
  backgroundColor: [0, 0, 0] as [number, number, number],
  ambientLight: 0,
  directionalLight: 0,
  cardinalLight: 'default',
  eyeHeight: 0,
  gameMode: undefined as GameMode | undefined,
  lookingAtBlock: undefined as {
    x: number
    y: number
    z: number
    face?: number
    shapes: BlocksShapes
  } | undefined,
  diggingBlock: undefined as {
    x: number
    y: number
    z: number
    stage: number
    face?: number
    mergedShape: BlockShape | undefined
  } | undefined,
  movementState: 'NOT_MOVING' as MovementState,
  onGround: true,
  sneaking: false,
  flying: false,
  sprinting: false,
  itemUsageTicks: 0,
  username: '',
  onlineMode: false,
  lightingDisabled: false,
  shouldHideHand: false,
  heldItemMain: undefined as HandItemBlock | undefined,
  heldItemOff: undefined as HandItemBlock | undefined,
  perspective: 'first_person' as CameraPerspective,
  birdseyeYaw: 0,
  birdseyePitch: DEFAULT_BIRDSEYE_PITCH,
  birdseyeDistance: DEFAULT_BIRDSEYE_DISTANCE,
  birdseyePanX: 0,
  birdseyePanY: 0,
  birdseyePanZ: 0,
  onFire: false,

  cameraSpectatingEntity: undefined as number | undefined,

  team: undefined as Team | undefined,
})

export const getPlayerStateUtils = (reactive: PlayerStateReactive) => ({
  isSpectator () {
    return reactive.gameMode === 'spectator'
  },
  isSpectatingEntity () {
    return reactive.cameraSpectatingEntity !== undefined && reactive.gameMode === 'spectator'
  },
  isThirdPerson () {
    if ((this as PlayerStateUtils).isSpectatingEntity()) return false
    return reactive.perspective === 'third_person_back' || reactive.perspective === 'third_person_front' || reactive.perspective === 'birdseye'
  }
})

export const getInitialPlayerStateRenderer = () => ({
  reactive: getInitialPlayerState()
})

export type PlayerStateReactive = ReturnType<typeof getInitialPlayerState>
export type PlayerStateUtils = ReturnType<typeof getPlayerStateUtils>

export type PlayerStateRenderer = PlayerStateReactive

export const getItemSelector = (playerState: PlayerStateRenderer, specificProperties: ItemSpecificContextProperties, item?: import('prismarine-item').Item) => {
  return {
    ...specificProperties,
    'minecraft:date': new Date(),
    // "minecraft:context_dimension": bot.entityp,
    // 'minecraft:time': bot.time.timeOfDay / 24_000,
  }
}
