import { createBrowserRouter } from "react-router-dom";

import { AppLayout } from "./layout/AppLayout";
import { CategoriesPage } from "./features/categories/CategoriesPage";
import { ChatPage } from "./features/chat/ChatPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { ExpensesPage } from "./features/expenses/ExpensesPage";
import { FoodPage } from "./features/food/FoodPage";
import { ImportsPage } from "./features/imports/ImportsPage";
import { PricesPage } from "./features/prices/PricesPage";
import { ReceiptsPage } from "./features/receipts/ReceiptsPage";
import { PlannedPage } from "./features/planned/PlannedPage";
import { ShoppingPage } from "./features/shopping/ShoppingPage";
import { RecurringPage } from "./features/recurring/RecurringPage";
import { SettingsPage } from "./features/settings/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <DashboardPage /> },
      { path: "chat", element: <ChatPage /> },
      { path: "expenses", element: <ExpensesPage /> },
      { path: "food", element: <FoodPage /> },
      { path: "receipts", element: <ReceiptsPage /> },
      { path: "imports", element: <ImportsPage /> },
      { path: "prices", element: <PricesPage /> },
      { path: "shopping", element: <ShoppingPage /> },
      { path: "planned", element: <PlannedPage /> },
      { path: "recurring", element: <RecurringPage /> },
      { path: "categories", element: <CategoriesPage /> },
      { path: "settings", element: <SettingsPage /> },
    ],
  },
]);
