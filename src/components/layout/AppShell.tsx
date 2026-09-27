import { NavLink, Outlet } from 'react-router-dom'
import { cx } from '../../lib/cx'

/** 构建时间戳：方便确认浏览器里跑的是不是最新一版（旧 bundle 会显示旧时间） */
const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__.replace('T', ' ').slice(0, 19) : 'dev'

const NAV_ITEMS = [
  { to: '/', label: '生成器', end: true },
  { to: '/guide', label: '说明', end: false },
]

export function AppShell() {
  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-6 px-4 py-5 sm:px-6">
      <header className="mc-panel flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center border-4 border-black bg-grass-500 shadow-[inset_-4px_-4px_0_0_#4e8a22,inset_4px_4px_0_0_#8bc34a]">
            <span className="block h-2 w-2 bg-[#3b2a17]" />
          </span>
          <div>
            <h1 className="mc-title text-[17px] text-grass-400 sm:text-[20px]">Minecraft 名牌工坊</h1>
            <p className="font-sans text-xs text-ink-200">
              上传皮肤 + 填写 ID → 生成黄金分割构图的横版像素名牌
            </p>
          </div>
        </div>

        <nav className="flex gap-2">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="no-underline">
              {({ isActive }) => (
                <span className={cx('mc-chip inline-block', isActive && 'text-grass-400')}>
                  {item.label}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="mc-panel-flat flex flex-wrap items-center justify-between gap-3 px-4 py-3 font-sans text-xs text-ink-300">
        <span>
          全部处理都在你的浏览器本地完成，皮肤图片不会上传到任何服务器。
        </span>
        <span>
          构建于 {BUILD_TIME} · 字体：Silkscreen / Press Start 2P（SIL OFL 1.1） · 皮肤与 Minecraft
          版权归 Mojang 所有，本项目与 Mojang 无关。
        </span>
      </footer>
    </div>
  )
}
