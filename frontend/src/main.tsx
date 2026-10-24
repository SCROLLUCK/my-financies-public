import "@mantine/core/styles.css";
import "@mantine/charts/styles.css";
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "./index.css";
import "./i18n";
import "dayjs/locale/pt-br";

import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { DatesProvider } from "@mantine/dates";
import { ModalsProvider } from "@mantine/modals";
import { Notifications } from "@mantine/notifications";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { useTranslation } from "react-i18next";

import { AuthGate } from "./features/auth/AuthGate";
import { ApiError } from "./lib/api";
import { router } from "./router";
import { theme } from "./theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
  // A session expiring mid-use would otherwise surface as a cryptic generic
  // error on whatever action the user happened to take — instead, bounce
  // back to the login screen (AuthGate reacts to this query invalidating).
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        queryClient.invalidateQueries({ queryKey: ["auth", "me"] });
      }
    },
  }),
});

function LocalizedDates({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith("pt") ? "pt-br" : "en";
  return <DatesProvider settings={{ locale }}>{children}</DatesProvider>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications />
      <ModalsProvider>
        <QueryClientProvider client={queryClient}>
          <LocalizedDates>
            <AuthGate>
              <RouterProvider router={router} />
            </AuthGate>
          </LocalizedDates>
        </QueryClientProvider>
      </ModalsProvider>
    </MantineProvider>
  </StrictMode>
);
