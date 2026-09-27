import { createBrowserRouter } from 'react-router-dom'
import { AppShell } from '../components/layout/AppShell'
import { GuidePage } from '../pages/GuidePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { StudioPage } from '../pages/StudioPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <StudioPage /> },
      { path: 'guide', element: <GuidePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
