import type { ReactNode } from "react";
import { Center, Loader } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/api";
import type { MeResponse } from "../../api/types";
import { LoginPage } from "./LoginPage";

export function AuthGate({ children }: { children: ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api.get<MeResponse>("/auth/me/"),
  });

  if (isLoading || !data) {
    return (
      <Center h="100vh">
        <Loader />
      </Center>
    );
  }

  if (!data.authenticated) return <LoginPage />;

  return <>{children}</>;
}
