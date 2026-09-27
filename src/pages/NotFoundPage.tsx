import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="mc-panel mx-auto max-w-lg p-6 text-center">
      <p className="mc-title text-[28px] text-grass-400">404</p>
      <p className="mt-3 font-sans text-sm text-ink-200">这个坐标没有方块。</p>
      <Link to="/" className="mc-btn mt-5 inline-flex no-underline">
        回到名牌生成器
      </Link>
    </div>
  )
}
