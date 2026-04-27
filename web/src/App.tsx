import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-50 text-gray-800">
        {/* Sidebar */}
        <aside className="w-52 shrink-0 bg-gray-900 text-white flex flex-col">
          <div className="p-4 border-b border-gray-700">
            <h1 className="font-bold text-sm leading-tight">
              Travel Agent<br />Coordinator
            </h1>
            <p className="text-xs text-gray-400 mt-1">A2A Protocol</p>
          </div>
          <nav className="flex-1 p-3 space-y-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`
              }
            >
              💬 對話
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`
              }
            >
              ⚙️ Prompt 設定
            </NavLink>
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
