"use client";

import { Button, Card, Text, TextInput } from "@gravity-ui/uikit";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams()?.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
    setLoading(false);
    if (res.ok) router.replace(next.startsWith("/") ? next : "/");
    else setError((await res.json().catch(() => ({})))?.error ?? "Ошибка входа");
  };
  return (
    <div className="login-wrap">
      <Card view="outlined" style={{ padding: 24, width: 340 }}>
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Text variant="header-1">Вход</Text>
          <Text color="secondary">Мероприятия по спортивному программированию</Text>
          <TextInput type="password" size="l" placeholder="Пароль" value={password} onUpdate={setPassword} autoFocus error={error || undefined} />
          <Button type="submit" view="action" size="l" loading={loading}>
            Войти
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
