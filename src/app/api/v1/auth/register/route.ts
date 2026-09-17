import { clientIp, enforceRateLimit } from "@/lib/api/auth";
import { apiOk, handleApiError, parseJsonBody } from "@/lib/api/response";
import { issueTokenPair } from "@/lib/api/tokens";
import { logger } from "@/lib/logger";
import { RATE_LIMIT_BUCKETS, RATE_LIMITS } from "@/lib/rate-limit";
import { registerSchema } from "@/schemas/auth.schema";
import { authService } from "@/services/auth.service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await enforceRateLimit(request, RATE_LIMIT_BUCKETS.register, RATE_LIMITS.register);

    const body = await parseJsonBody(request, registerSchema);

    // authService.register luôn tạo role USER — không nhận role từ body.
    const user = await authService.register(body);
    logger.info("API register", { userId: user.id });

    const tokens = await issueTokenPair(user, {
      userAgent: request.headers.get("user-agent"),
      ip: clientIp(request),
    });

    return apiOk({ user, ...tokens }, 201);
  } catch (error) {
    return handleApiError(error, { route: "POST /api/v1/auth/register", request });
  }
}
