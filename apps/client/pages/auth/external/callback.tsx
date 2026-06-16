import { setCookie } from "cookies-next";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";

export default function ExternalLoginCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!router.isReady) return;

    const { token, redirect } = router.query as {
      token?: string;
      redirect?: string;
    };

    if (!token) {
      setError("Missing session token in callback URL.");
      return;
    }

    setCookie("session", token);

    const destination =
      typeof redirect === "string" && redirect.startsWith("/")
        ? redirect
        : "/";

    router.replace(destination);
  }, [router.isReady, router.query]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-2">
        {error ? (
          <>
            <h1 className="text-xl font-semibold text-foreground">
              Sign-in failed
            </h1>
            <p className="text-sm text-muted-foreground">{error}</p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-foreground">
              Signing you in…
            </h1>
            <p className="text-sm text-muted-foreground">
              Please wait while we finish authenticating your session.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
