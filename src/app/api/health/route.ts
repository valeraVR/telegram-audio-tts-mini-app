export const dynamic = "force-dynamic";

/** Проверка живости приложения. База данных проекту не нужна. */
export async function GET() {
  return Response.json({
    ok: true,
    bot: Boolean(process.env.BOT_TOKEN),
    webappUrl: process.env.WEBAPP_URL ?? null,
  });
}
