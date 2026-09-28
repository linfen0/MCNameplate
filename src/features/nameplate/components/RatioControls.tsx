import { ChipRow, Field, PixelButton, PixelChip, PixelSlider } from '../../../components/pixel'
import { GOLDEN_MINOR, snapToGolden } from '../../../lib/golden'
import {
  ASPECT_PRESETS,
  MAX_ID_LINES_OPTIONS,
  SPLIT_PRESETS,
  type AspectSetting,
  type NameplateConfig,
} from '../config'
import { resolveOutputSize } from '../resolve'

export interface RatioControlsProps {
  config: NameplateConfig
  patch: (changes: Partial<NameplateConfig>) => void
}

function isActiveAspect(current: AspectSetting, value: AspectSetting): boolean {
  if (current === 'auto' || value === 'auto') return current === value
  return Math.abs(current - value) < 1e-9
}

/** 铭牌宽高比 + 两块比例 + 头像风格，默认黄金分割切两块 */
export function RatioControls({ config, patch }: RatioControlsProps) {
  const leftPercent = config.ratioLeft * 100
  const avatarPercent = config.avatarSide === 'left' ? leftPercent : 100 - leftPercent
  const idPercent = 100 - avatarPercent
  const golden = config.splitMode === 'ratio'
  const size = resolveOutputSize(config)
  const aspectText =
    config.aspect === 'auto'
      ? `自动选到 ${(size.width / size.height).toFixed(2)} : 1`
      : `${config.aspect.toFixed(2)} : 1`

  return (
    <div className="space-y-5">
      <Field
        label="铭牌宽高比"
        aside={<span className="mc-label text-ink-300">{`${size.width}×${size.height}`}</span>}
        hint={`当前 ${aspectText} · 铭牌只用这几个标准规格；文字长度不改矩形，改的是矩形里的排法（换行 + 缩放）`}
      >
        <ChipRow>
          {ASPECT_PRESETS.map((preset) => (
            <PixelChip
              key={preset.id}
              active={isActiveAspect(config.aspect, preset.value)}
              onClick={() => patch({ aspect: preset.value })}
              title={preset.hint}
            >
              {preset.label}
            </PixelChip>
          ))}
        </ChipRow>
      </Field>

      <Field
        label="两块怎么切"
        aside={
          <span className={golden ? 'mc-label text-gold-400' : 'mc-label text-ink-300'}>
            {golden ? '严格黄金分割' : '贴合头像'}
          </span>
        }
        hint={`当前实际：头像 ${avatarPercent.toFixed(2)}% : ID ${idPercent.toFixed(2)}%。黄金分割切两块时 ID 宽度被锁死，字高最多到铭牌高度的 22%；贴合头像能把字高做到 38% 左右。`}
      >
        <ChipRow>
          {SPLIT_PRESETS.map((preset) => (
            <PixelChip
              key={preset.id}
              active={config.splitMode === preset.mode && preset.ratioLeft === config.ratioLeft}
              onClick={() =>
                patch({
                  splitMode: preset.mode,
                  ratioLeft: preset.ratioLeft,
                  avatarSide: preset.avatarSide,
                })
              }
              title={preset.hint}
            >
              {preset.label}
            </PixelChip>
          ))}
        </ChipRow>
      </Field>

      <Field
        label="ID 最多折几行"
        hint="比例固定后，长 ID 靠换行 + 缩放塞满名字区；单行放不下时会自动折到设定行数再定字号"
      >
        <ChipRow>
          {MAX_ID_LINES_OPTIONS.map((lines) => (
            <PixelChip
              key={lines}
              active={config.maxIdLines === lines}
              onClick={() => patch({ maxIdLines: lines })}
            >
              {lines} 行
            </PixelChip>
          ))}
        </ChipRow>
      </Field>

      <PixelSlider
        label="左区域宽度"
        value={config.ratioLeft}
        min={0.2}
        max={0.8}
        step={0.001}
        valueText={`${leftPercent.toFixed(1)}%`}
        onChange={(value) => patch({ splitMode: 'ratio', ratioLeft: snapToGolden(value) })}
        hint="拖动即切换到严格按比例切分；拖到 0.618 / 0.382 附近会自动吸附成精确黄金分割值"
      />

      <div className="flex flex-wrap gap-2">
        <PixelButton
          variant="ghost"
          onClick={() => patch({ avatarSide: config.avatarSide === 'left' ? 'right' : 'left' })}
        >
          左右互换
        </PixelButton>
        <PixelButton
          variant="ghost"
          onClick={() => patch({ ratioLeft: GOLDEN_MINOR, avatarSide: config.avatarSide })}
        >
          回到黄金分割
        </PixelButton>
      </div>

      <Field
        label="头像风格"
        hint="3D 立体用 three.js 渲染真正的方块模型（逐面光照 + 帽子外壳），更接近游戏内物品栏里的效果。"
      >
        <ChipRow>
          <PixelChip active={config.headStyle === 'iso'} onClick={() => patch({ headStyle: 'iso' })}>
            3D 立体
          </PixelChip>
          <PixelChip active={config.headStyle === 'flat'} onClick={() => patch({ headStyle: 'flat' })}>
            2D 正面
          </PixelChip>
        </ChipRow>
      </Field>

      <PixelSlider
        label="头像大小"
        value={config.avatarFill}
        min={0.5}
        max={1}
        step={0.01}
        valueText={`${Math.round(config.avatarFill * 100)}%`}
        onChange={(value) => patch({ avatarFill: value })}
      />
    </div>
  )
}
