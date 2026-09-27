import { ChipRow, Field, PixelChip, PixelToggle } from '../../../components/pixel'
import { cx } from '../../../lib/cx'
import { PIXEL_FONTS } from '../../../lib/pixelFont'
import { THEMES } from '../../../lib/themes'
import type { TextStyle } from '../../../lib/textPlan'
import type { TextureLibraryState } from '../../../hooks/useTextureLibrary'
import type { NameplateConfig } from '../config'
import { CUSTOM_THEME_ID } from '../theme'
import { TextureThemePanel } from './TextureThemePanel'

export interface AppearanceControlsProps {
  config: NameplateConfig
  patch: (changes: Partial<NameplateConfig>) => void
  library: TextureLibraryState
  /** 画布上实测出来的文字配色 */
  textStyle?: TextStyle | null
}

/** 底色主题、ID 字体与文字样式开关 */
export function AppearanceControls({ config, patch, library, textStyle }: AppearanceControlsProps) {
  return (
    <div className="space-y-5">
      <Field
        label="底色主题"
        hint="内置主题都是程序化生成的；第 7 项「自定义纹理」可以上传任意方块贴图（含 Mod），配色由程序从贴图里提取。"
      >
        <ChipRow>
          {THEMES.map((theme) => (
            <PixelChip
              key={theme.id}
              active={config.themeId === theme.id}
              onClick={() => patch({ themeId: theme.id })}
              title={theme.description}
            >
              <span className="flex items-center gap-2">
                <span className="flex">
                  {theme.swatch.map((color) => (
                    <span
                      key={color}
                      className="block h-3 w-3 border border-black"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                {theme.name}
              </span>
            </PixelChip>
          ))}
          <PixelChip
            active={config.themeId === CUSTOM_THEME_ID}
            onClick={() => patch({ themeId: CUSTOM_THEME_ID })}
            disabled={!config.customTexture}
            title={
              config.customTexture
                ? `使用「${config.customTexture.name}」提取的配色`
                : '先在下面上传一张方块贴图'
            }
          >
            <span className="flex items-center gap-2">
              {config.customTexture ? (
                <span className="flex">
                  {config.customTexture.palette.dominant.slice(0, 3).map((color) => (
                    <span
                      key={color}
                      className="block h-3 w-3 border border-black"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
              ) : null}
              自定义纹理
            </span>
          </PixelChip>
        </ChipRow>
      </Field>

      <TextureThemePanel config={config} patch={patch} library={library} textStyle={textStyle} />

      <Field label="ID 字体" hint="两种字体都是 SIL OFL 开源许可，已随项目本地托管。">
        <ChipRow>
          {PIXEL_FONTS.map((font) => (
            <PixelChip
              key={font.id}
              active={config.fontId === font.id}
              onClick={() => patch({ fontId: font.id })}
              title={font.description}
              style={{ fontFamily: `${font.cssFamily}, monospace` }}
            >
              {font.name}
            </PixelChip>
          ))}
        </ChipRow>
      </Field>

      <Field label="样式开关">
        <div className={cx('grid gap-3', 'sm:grid-cols-2')}>
          <PixelToggle
            label="ID 全大写"
            checked={config.uppercase}
            onChange={(checked) => patch({ uppercase: checked })}
          />
          <PixelToggle
            label="文字阴影"
            hint="Minecraft 原版 1 像素投影"
            checked={config.shadow}
            onChange={(checked) => patch({ shadow: checked })}
          />
          <PixelToggle
            label="同族描边"
            hint="关：用投影 + 必要时的同色系柔化底；开：亮字加一圈描边"
            checked={config.textOutline}
            onChange={(checked) => patch({ textOutline: checked })}
          />
          <PixelToggle
            label="黄金分割分割线"
            checked={config.showDivider}
            onChange={(checked) => patch({ showDivider: checked })}
          />
          <PixelToggle
            label="文字区压暗"
            hint="可选的装饰层；文字可读性已由描边保证"
            checked={config.textBackdrop}
            onChange={(checked) => patch({ textBackdrop: checked })}
          />
          <PixelToggle
            label="黄金辅助线"
            hint="仅用于校核比例，导出前建议关闭"
            checked={config.showGuides}
            onChange={(checked) => patch({ showGuides: checked })}
          />
        </div>
      </Field>
    </div>
  )
}
