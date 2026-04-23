import { EventEmitter } from 'events'
import type { Bot } from 'mineflayer'

export interface MineflayerViewerOptions {
  viewDistance?: number
  firstPerson?: boolean
  port?: number
  prefix?: string
}

export interface ViewerPoint {
  x: number
  y: number
  z: number
}

export interface MineflayerViewer extends EventEmitter {
  drawLine(id: string, points: ViewerPoint[], color?: number): void
  drawPoints(id: string, points: ViewerPoint[], color?: number, size?: number): void
  drawBoxGrid(id: string, start: ViewerPoint, end: ViewerPoint, color?: number | string): void
  erase(id: string): void
  close(): void
}

export declare function mineflayer(bot: Bot, settings?: MineflayerViewerOptions): MineflayerViewer

declare module 'mineflayer' {
  interface Bot {
    viewer: MineflayerViewer
  }
}
