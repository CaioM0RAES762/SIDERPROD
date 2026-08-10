"use client";
// hooks/use-admin-users.ts

import { useState, useCallback, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type AdminUser = {
  usuario_id: string;
  empresa_id: string;
  public_id: string | null;
  nome: string;
  email: string | null;
  provider: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string | null;
  deleted_at: string | null;
};

export type CreateUserPayload = {
  nome: string;
  email: string;
  senha: string;
  isActive?: boolean;
};

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Buscar todos ────────────────────────────────────────────────────────────
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/users", {
        credentials: "include",
        cache: "no-store",
      });
      const data = (await readJson(res)) as
        | ApiOk<{ users: AdminUser[] }>
        | ApiErr
        | null;

      if (!res.ok || !data || !(data as any).ok) {
        throw new Error((data as any)?.error ?? `HTTP ${res.status}`);
      }

      setUsers((data as ApiOk<{ users: AdminUser[] }>).users);
    } catch (e: any) {
      setError(e?.message ?? "Erro de rede ao buscar usuários.");
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Criar usuário ───────────────────────────────────────────────────────────
  const createUser = useCallback(
    async (
      payload: CreateUserPayload,
    ): Promise<
      { ok: true; user: AdminUser } | { ok: false; error: string }
    > => {
      try {
        const res = await fetch("/api/admin/users", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = (await readJson(res)) as
          | ApiOk<{ user: AdminUser }>
          | ApiErr
          | null;

        if (!res.ok || !data || !(data as any).ok) {
          const msg = (data as any)?.error ?? `HTTP ${res.status}`;
          return { ok: false, error: msg };
        }

        // Atualiza a lista sem refetch completo
        const newUser = (data as ApiOk<{ user: AdminUser }>).user;
        setUsers((prev) => [newUser, ...prev]);
        return { ok: true, user: newUser };
      } catch (e: any) {
        return {
          ok: false,
          error: e?.message ?? "Erro de rede ao criar usuário.",
        };
      }
    },
    [],
  );

  // ── Deletar usuário ─────────────────────────────────────────────────────────
  const deleteUser = useCallback(
    async (
      usuarioId: string,
    ): Promise<{ ok: true } | { ok: false; error: string }> => {
      try {
        const res = await fetch(
          `/api/admin/users?id=${encodeURIComponent(usuarioId)}`,
          { method: "DELETE", credentials: "include" },
        );
        const data = (await readJson(res)) as ApiOk<Record<string, never>> | ApiErr | null;

        if (!res.ok || !data || !(data as any).ok) {
          const msg = (data as any)?.error ?? `HTTP ${res.status}`;
          return { ok: false, error: msg };
        }

        // Remove da lista local (soft-delete — marca deleted_at)
        setUsers((prev) =>
          prev.map((u) =>
            u.usuario_id === usuarioId
              ? { ...u, deleted_at: new Date().toISOString(), is_active: false }
              : u,
          ),
        );
        return { ok: true };
      } catch (e: any) {
        return {
          ok: false,
          error: e?.message ?? "Erro de rede ao deletar usuário.",
        };
      }
    },
    [],
  );

  // ── Efeito inicial ──────────────────────────────────────────────────────────
  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return {
    users,
    loading,
    error,
    /** Recarrega a lista completa do servidor */
    fetchUsers,
    createUser,
    deleteUser,
  };
}
