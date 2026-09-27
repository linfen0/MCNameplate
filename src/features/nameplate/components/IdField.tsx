import { Field } from '../../../components/pixel'

export interface IdFieldProps {
  value: string
  onChange: (value: string) => void
}

/** Minecraft 正版 ID 规则：3-16 位，字母 / 数字 / 下划线 */
const VALID_ID = /^[A-Za-z0-9_]{3,16}$/
const MAX_LENGTH = 16

export function IdField({ value, onChange }: IdFieldProps) {
  const trimmed = value.trim()
  const invalid = trimmed.length > 0 && !VALID_ID.test(trimmed)
  const nonAscii = /[^\x20-\x7E]/.test(trimmed)

  return (
    <Field
      label="玩家 ID"
      aside={<span className="mc-label text-ink-300">{trimmed.length}/16</span>}
      hint={
        invalid
          ? '常规 ID 为 3-16 位字母、数字或下划线；仍可继续生成，但不保证像正版 ID。'
          : nonAscii
            ? '检测到非 ASCII 字符：像素字体没有对应字形，会用系统字体回退后同样做点阵化处理。'
            : '留空时名牌上会显示占位文字 YOUR_ID，此时无法导出。'
      }
    >
      <input
        data-testid="id-input"
        className="mc-input"
        value={value}
        maxLength={MAX_LENGTH}
        spellCheck={false}
        autoComplete="off"
        placeholder="Notch"
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  )
}
