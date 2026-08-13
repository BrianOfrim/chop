import { readFile, unlink, writeFile } from "node:fs/promises";
import { TOKEN_PATH } from "./env.ts";

export type StravaAthlete = {
  id: number;
  firstname?: string;
  lastname?: string;
};

export type StoredTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  athlete?: StravaAthlete;
};

export async function readTokens(): Promise<StoredTokens | null> {
  try {
    const raw = await readFile(TOKEN_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<StoredTokens>;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string" ||
      typeof parsed.expiresAt !== "number"
    ) {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      athlete: parsed.athlete,
    };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

export async function writeTokens(tokens: StoredTokens): Promise<void> {
  await writeFile(TOKEN_PATH, `${JSON.stringify(tokens, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function deleteTokens(): Promise<void> {
  try {
    await unlink(TOKEN_PATH);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw e;
  }
}
