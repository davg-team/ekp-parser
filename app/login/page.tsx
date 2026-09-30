"use client";

import { Button, Card, Text, TextInput } from "@gravity-ui/uikit";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { BASE_PATH, isProtected, login } from "@/lib/client/data";

function LoginForm() {
  const next = useSearchParams()?.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // данные без пароля — вход не нужен
  useEffect(() => {
    isProtected().then((p) => p || location.replace(BASE_PATH + (next.startsWith("/") ? next : "/")), () => {});
  }, [next]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    // пароль проверяется расшифровкой данных прямо в браузере
    const ok = await login(password).catch(() => false);
    setLoading(false);
    // полная загрузка: запросы, упавшие до входа, не должны остаться в кэше
    if (ok) location.replace(BASE_PATH + (next.startsWith("/") ? next : "/"));
    else setError("Неверный пароль");
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
