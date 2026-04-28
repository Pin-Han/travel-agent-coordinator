import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import SettingsPage from "./pages/SettingsPage";
import LogsPage from "./pages/LogsPage";

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-gray-50 text-gray-800">
        {/* Sidebar */}
        <aside className="w-14 sm:w-48 shrink-0 bg-gray-900 text-white flex flex-col">
          <div className="p-3 sm:p-4 border-b border-gray-700">
            <h1 className="font-bold text-sm leading-tight hidden sm:block">
              Travel Agent<br />Coordinator
            </h1>
            {/* Mobile: show icon only */}
            <span className="text-lg sm:hidden" title="Travel Agent Coordinator">✈️</span>
            <p className="text-xs text-gray-400 mt-1 hidden sm:block">A2A Protocol</p>
          </div>
          <nav className="flex-1 p-2 sm:p-3 space-y-1">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center justify-center sm:justify-start gap-2 px-2 sm:px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`
              }
              title="Chat"
            >
              <span className="text-base">💬</span>
              <span className="hidden sm:inline">Chat</span>
            </NavLink>
            <NavLink
              to="/logs"
              className={({ isActive }) =>
                `flex items-center justify-center sm:justify-start gap-2 px-2 sm:px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`
              }
              title="Logs"
            >
              <span className="text-base">📋</span>
              <span className="hidden sm:inline">Logs</span>
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center justify-center sm:justify-start gap-2 px-2 sm:px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-600 text-white"
                    : "text-gray-300 hover:bg-gray-700"
                }`
              }
              title="Settings"
            >
              <span className="text-base">⚙️</span>
              <span className="hidden sm:inline">Settings</span>
            </NavLink>
          </nav>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          <Routes>
            <Route path="/" element={<ChatPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
