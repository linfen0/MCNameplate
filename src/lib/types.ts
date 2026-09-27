/**
 * 全局基础类型：所有像素级图像操作都在 RgbaImage 上进行，
 * 使解析 / 合成逻辑与 DOM、Canvas 完全解耦，可在 Node 里直接单元测试。
 */

/** 未预乘 alpha 的 RGBA 位图 */
export interface RgbaImage {
  readonly width: number
  readonly height: number
  /** 长度 = width * height * 4，取值 0-255 */
  readonly data: Uint8ClampedArray
}

/** 矩形区域（左上角 + 宽高），单位均为“皮肤像素” */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** 皮肤模型：经典 4px 手臂 / 纤细 3px 手臂 */
export type SkinModel = 'classic' | 'slim'

/** 皮肤格式：64×64 现代版（含第二层帽子）/ 64×32 旧版（无第二层） */
export type SkinFormat = 'modern' | 'legacy'

export type IssueLevel = 'error' | 'warning' | 'info'

export interface SkinIssue {
  level: IssueLevel
  message: string
}

/**
 * 头部每个面在皮肤里的边长，标准皮肤固定为 8 皮肤像素。
 * 名牌渲染中它同时是“1 皮肤像素 = headScale 画布像素”的换算基准。
 */
export const HEAD_FACE_SIZE = 8

/** 头部三个可见面的贴图（正面 / 侧面 / 顶面） */
export interface HeadFaces {
  /** 每个面的贴图边长，标准皮肤为 8 */
  faceSize: number
  /** 正面（脸） */
  front: RgbaImage
  /** 侧面：观察者看到的右侧面 = 角色左脸 */
  side: RgbaImage
  /** 顶面（头顶） */
  top: RgbaImage
  /** 是否叠加了第二层（帽子 / 头发） */
  hasOverlay: boolean
}

/** 解析后的皮肤 */
export interface ParsedSkin {
  /** 原始 64×64 位图 */
  image: RgbaImage
  width: number
  height: number
  format: SkinFormat
  model: SkinModel
  hasOverlay: boolean
  issues: SkinIssue[]
  fileName?: string
}
