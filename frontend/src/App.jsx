import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NightCount from './pages/NightCount.jsx';
import InitialStock from './pages/InitialStock.jsx';
import Daily from './pages/Daily.jsx';
import Waste from './pages/Waste.jsx';
import Orders from './pages/Orders.jsx';
import Items from './pages/Items.jsx';
import Recipes from './pages/Recipes.jsx';
import Buffers from './pages/Buffers.jsx';
import Users from './pages/Users.jsx';
import Audit from './pages/Audit.jsx';

function RequireDirection({ children }) {
  const { isDirection } = useAuth();
  return isDirection ? children : <Navigate to="/" replace />;
}
function RequireFloor({ children }) {
  const { isFloor } = useAuth();
  return isFloor ? children : <Navigate to="/" replace />;
}
function RequireOrders({ children }) {
  const { canOrders } = useAuth();
  return canOrders ? children : <Navigate to="/" replace />;
}

export default function App() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Login />;
  if (user.mustChangePassword) return <ChangePassword forced />;

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/night-count" element={<RequireFloor><NightCount /></RequireFloor>} />
        <Route path="/daily" element={<RequireFloor><Daily /></RequireFloor>} />
        <Route path="/orders" element={<RequireOrders><Orders /></RequireOrders>} />
        <Route path="/waste" element={<RequireDirection><Waste /></RequireDirection>} />
        <Route path="/initial-stock" element={<RequireDirection><InitialStock /></RequireDirection>} />
        <Route path="/items" element={<RequireDirection><Items /></RequireDirection>} />
        <Route path="/recipes" element={<RequireDirection><Recipes /></RequireDirection>} />
        <Route path="/buffers" element={<RequireDirection><Buffers /></RequireDirection>} />
        <Route path="/users" element={<RequireDirection><Users /></RequireDirection>} />
        <Route path="/audit" element={<RequireDirection><Audit /></RequireDirection>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
