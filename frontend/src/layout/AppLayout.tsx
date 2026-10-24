import {
  ActionIcon,
  AppShell,
  Burger,
  Group,
  NavLink,
  SegmentedControl,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
  IconClipboardList,
  IconCoins,
  IconFileImport,
  IconLayoutDashboard,
  IconLogout,
  IconMessageChatbot,
  IconMoon,
  IconReceipt2,
  IconRepeat,
  IconScan,
  IconSettings,
  IconShoppingCart,
  IconSun,
  IconTags,
  IconToolsKitchen2,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";

import { api } from "../lib/api";
import type { MeResponse } from "../api/types";

const NAV = [
  { to: "/", key: "nav.dashboard", icon: IconLayoutDashboard },
  { to: "/chat", key: "nav.chat", icon: IconMessageChatbot },
  { to: "/expenses", key: "nav.expenses", icon: IconReceipt2 },
  { to: "/receipts", key: "nav.receipts", icon: IconScan },
  { to: "/imports", key: "nav.imports", icon: IconFileImport },
  { to: "/food", key: "nav.food", icon: IconToolsKitchen2 },
  { to: "/prices", key: "nav.prices", icon: IconCoins },
  { to: "/shopping", key: "nav.shopping", icon: IconShoppingCart },
  { to: "/planned", key: "nav.planned", icon: IconClipboardList },
  { to: "/recurring", key: "nav.recurring", icon: IconRepeat },
  { to: "/categories", key: "nav.categories", icon: IconTags },
  { to: "/settings", key: "nav.settings", icon: IconSettings },
];

function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light", { getInitialValueInEffect: true });
  const isDark = computed === "dark";
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label="Toggle color scheme"
      onClick={() => setColorScheme(isDark ? "light" : "dark")}
    >
      {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
    </ActionIcon>
  );
}

function LogoutButton() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: () => api.post("/auth/logout/", {}),
    onSuccess: () => {
      qc.setQueryData<MeResponse>(["auth", "me"], { authenticated: false });
    },
  });
  return (
    <ActionIcon
      variant="default"
      size="lg"
      aria-label={t("auth.logout")}
      onClick={() => logoutMutation.mutate()}
    >
      <IconLogout size={18} />
    </ActionIcon>
  );
}

export function AppLayout() {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("pt") ? "pt" : "en";
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: "sm", collapsed: { mobile: !navOpened } }}
      padding="md"
    >
      <AppShell.Header>
        <div className="grid h-full grid-cols-[auto_1fr_auto] items-center gap-2 px-4">
          <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" />
          <Title order={4} className="truncate">
            my-finances
          </Title>
          <Group gap="sm" wrap="nowrap">
            <SegmentedControl
              size="xs"
              value={lang}
              onChange={(v) => i18n.changeLanguage(v)}
              data={[
                { label: "PT", value: "pt" },
                { label: "EN", value: "en" },
              ]}
              visibleFrom="xs"
            />
            <ThemeToggle />
            <LogoutButton />
          </Group>
        </div>
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            component={Link}
            to={item.to}
            label={t(item.key)}
            leftSection={<item.icon size={18} />}
            active={pathname === item.to}
            onClick={closeNav}
          />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
