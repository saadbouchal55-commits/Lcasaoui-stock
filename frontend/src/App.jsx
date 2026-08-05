import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Sales from './pages/Sales.jsx';
import Stock from './pages/Stock.jsx';
import Pertes from './pages/Pertes.jsx';
import Emballage from './pages/Emballage.jsx';
import PertesView from './pages/PertesView.jsx';
import InitialStock from './pages/InitialStock.jsx';
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
        {/* Floor: Manager / Shift-Leader / Direction */}
        <Route path="/sales" element={<RequireFloor><Sales /></RequireFloor>} />
        <Route path="/stock" element={<RequireFloor><Stock /></RequireFloor>} />
        <Route path="/pertes" element={<RequireFloor><Pertes /></RequireFloor>} />
        <Route path="/emballage" element={<RequireFloor><Emballage /></RequireFloor>} />
        <Route path="/pertes-view" element={<RequireFloor><PertesView /></RequireFloor>} />
        {/* Orders: Direction / Order Manager */}
        <Route path="/orders" element={<RequireOrders><Orders /></RequireOrders>} />
        {/* Direction only */}
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
