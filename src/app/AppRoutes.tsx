import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from '../permissions/AuthGuard';
import { RoleGuard } from '../permissions/RoleGuard';
import { StatusGuard } from '../permissions/StatusGuard';

import { PublicLayout } from '../pages/layouts/PublicLayout';
import { AdminLayout } from '../pages/layouts/AdminLayout';
import { AppLayout } from '../pages/layouts/AppLayout';
import { WorkerLayout } from '../pages/layouts/WorkerLayout';

import Login from '../pages/public/Login';
import Register from '../pages/public/Register';
import RedirectLogic from '../pages/public/RedirectLogic';
import Unauthorized from '../pages/public/Unauthorized';
import ForcePasswordChange from '../pages/public/ForcePasswordChange';

import CompanyProfile from '../pages/app/CompanyProfile';
import CompanyTeam from '../pages/app/CompanyTeam';
import UserProfileSettings from '../pages/app/UserProfileSettings';

import AdminCompanies from '../pages/admin/AdminCompanies';
import AdminUsers from '../pages/admin/AdminUsers';
import AdminInternalTeam from '../pages/admin/AdminInternalTeam';
import AdminInbounds from '../pages/admin/AdminInbounds';
import AdminOutbounds from '../pages/admin/outbound/AdminOutbounds';
import AdminWarehouse from '../pages/admin/AdminWarehouse';
import AdminWarehousesList from '../pages/admin/AdminWarehousesList';
import AdminIntegrations from '../pages/admin/AdminIntegrations';
import AdminShipments from '../pages/admin/AdminShipments';
import AdminCarrierContracts from '../pages/admin/AdminCarrierContracts';
import AdminClientPricing from '../pages/admin/AdminClientPricing';

import CompanyIntegrations from '../pages/app/integrations/CompanyIntegrations';
import AllegroCallbackPage from '../pages/app/integrations/AllegroCallbackPage';
import AllegroMappingsPage from '../pages/app/integrations/AllegroMappingsPage';
import CompanyProducts from '../pages/app/products/CompanyProducts';
import InboundList from '../pages/app/inbound/InboundList';
import { OutboundList } from '../pages/app/outbound/OutboundList';
import CompanyWarehouse from '../pages/app/warehouse/CompanyWarehouse';
import OrdersPage from '../pages/app/orders/OrdersPage';
import OrderDetailsPage from '../pages/app/orders/OrderDetailsPage';
import NewOrderPage from '../pages/app/orders/NewOrderPage';

import ShipmentsPage from '../pages/app/shipments/ShipmentsPage';
import NewShipmentPage from '../pages/app/shipments/NewShipmentPage';
import ClientPricingView from '../pages/app/shipments/ClientPricingView';

import FulfillmentQueuePage from '../pages/app/fulfillment/FulfillmentQueuePage';
import PackingStationPage from '../pages/app/fulfillment/PackingStationPage';
import ChangelogPage from '../pages/shared/ChangelogPage';

const AdminDashboard = () => <div>Admin Dashboard</div>;
import DashboardPage from '../pages/app/DashboardPage';
const WorkerDashboard = () => <div>Worker Dashboard</div>;

export const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/" element={<RedirectLogic />} />
      <Route path="/unauthorized" element={<Unauthorized />} />

      {/* Public Routes */}
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<div>Zapomniałem hasła</div>} />
      </Route>

      <Route path="/force-password-change" element={
        <AuthGuard>
          <ForcePasswordChange />
        </AuthGuard>
      } />

      {/* Admin Zone */}
      <Route path="/admin" element={
        <AuthGuard>
          <StatusGuard>
            <RoleGuard allowedRoles={['superadmin', 'admin']}>
              <AdminLayout />
            </RoleGuard>
          </StatusGuard>
        </AuthGuard>
      }>
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<AdminDashboard />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="team" element={<AdminInternalTeam />} />
        <Route path="companies" element={<AdminCompanies />} />
        <Route path="integrations" element={<AdminIntegrations />} />
        <Route path="shipments" element={<AdminShipments />} />
        <Route path="settings" element={<UserProfileSettings />} />
        <Route path="inbounds" element={<AdminInbounds />} />
        <Route path="outbounds" element={<AdminOutbounds />} />
        <Route path="warehouse" element={<AdminWarehouse />} />
        <Route path="fulfillment/warehouses" element={<AdminWarehousesList />} />
        <Route path="fulfillment" element={<FulfillmentQueuePage />} />
        <Route path="fulfillment/pack" element={<PackingStationPage />} />
        <Route path="fulfillment/pack/:id" element={<PackingStationPage />} />
        <Route path="carrier-contracts" element={<AdminCarrierContracts />} />
        <Route path="client-pricing" element={<AdminClientPricing />} />
        <Route path="changelog" element={<ChangelogPage />} />
      </Route>

      {/* App Zone */}
      <Route path="/app" element={
        <AuthGuard>
          <StatusGuard>
            <RoleGuard allowedRoles={['company_owner', 'company_admin', 'viewer']}>
              <AppLayout />
            </RoleGuard>
          </StatusGuard>
        </AuthGuard>
      }>
        <Route index element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="company" element={<CompanyProfile />} />
        <Route path="team" element={<CompanyTeam />} />
        <Route path="profile" element={<UserProfileSettings />} />
        <Route path="settings/integrations" element={<CompanyIntegrations />} />
        <Route path="integrations/allegro/callback" element={<AllegroCallbackPage />} />
        <Route path="integrations/allegro/:integrationId/mappings" element={<AllegroMappingsPage />} />
        <Route path="products" element={<CompanyProducts />} />
        <Route path="inbound" element={<InboundList />} />
        <Route path="outbound" element={<OutboundList />} />
        <Route path="warehouse" element={<CompanyWarehouse />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="orders/:id" element={<OrderDetailsPage />} />
        <Route path="shipments" element={<ShipmentsPage />} />
        <Route path="shipments/new" element={<NewShipmentPage />} />
        <Route path="shipments/pricing" element={<ClientPricingView />} />
        <Route path="changelog" element={<ChangelogPage />} />
      </Route>

      {/* Worker Zone */}
      <Route path="/worker" element={
        <AuthGuard>
          <StatusGuard>
            <RoleGuard allowedRoles={['worker']}>
              <WorkerLayout />
            </RoleGuard>
          </StatusGuard>
        </AuthGuard>
      }>
        <Route index element={<Navigate to="/worker/dashboard" replace />} />
        <Route path="dashboard" element={<WorkerDashboard />} />
        <Route path="fulfillment/pack" element={<PackingStationPage />} />
      </Route>

      {/* Default / Fallback - Route guard will handle it based on role */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};
