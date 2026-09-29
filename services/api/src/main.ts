import "reflect-metadata";
import "./config";
import { NestFactory } from "@nestjs/core";
import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  ExceptionFilter,
  Get,
  Headers,
  HttpException,
  Module,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { json, raw, Request, Response } from "express";
import { ZodError } from "zod";
import { Store } from "./db";
import { AppService } from "./service";
import { assertConfig, development } from "./config";
const service = new AppService(new Store());
@Catch()
class Errors implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const code =
      e instanceof ZodError
        ? 400
        : e instanceof HttpException
          ? e.getStatus()
          : 500;
    response.status(code).json({
      statusCode: code,
      message:
        e instanceof ZodError
          ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
          : e instanceof HttpException
            ? e.message
            : "Internal service error",
    });
    if (code === 500)
      console.error("Request failed:", e instanceof Error ? e.name : "unknown");
  }
}
@Controller()
class ApiController {
  @Get("health") health() {
    return {
      status: "ok",
      database: "sqlite",
      development_auth: development(),
      inference_mode: process.env.AI_MODE || "unavailable",
    };
  }
  @Get("crops") async crops() {
    let coverage: any = {};
    try {
      const r = await fetch(
        `${process.env.AI_URL || "http://127.0.0.1:8100"}/coverage`,
        {
          headers: {
            "X-Service-Token":
              process.env.AI_SERVICE_TOKEN || "local-development-only",
          },
          signal: AbortSignal.timeout(2000),
        },
      );
      if (r.ok) coverage = await r.json();
    } catch {}
    return ["tomato", "maize", "mahangu", "sorghum"].map((crop) => ({
      id: crop,
      name:
        crop === "mahangu"
          ? "Mahangu (pearl millet)"
          : crop[0].toUpperCase() + crop.slice(1),
      conditions: coverage.conditions?.[crop] || [],
      mode: coverage.mode || "unavailable",
      inference_available: !!coverage.conditions?.[crop]?.length,
      referral_available: true,
    }));
  }
  @Post("auth/dev") login(@Body() body: unknown) {
    return service.login(body);
  }
  @Post("auth/logout") logout(@Headers("authorization") h: string) {
    service.actor(h);
    return service.logout(h);
  }
  @Get("me") me(@Headers("authorization") h: string) {
    return service.actor(h);
  }
  @Get("fields") fields(@Headers("authorization") h: string) {
    return service.fields(service.actor(h));
  }
  @Post("fields") field(
    @Headers("authorization") h: string,
    @Body() b: unknown,
  ) {
    return service.createField(service.actor(h), b);
  }
  @Get("cases") cases(@Headers("authorization") h: string) {
    return service.listCases(service.actor(h));
  }
  @Post("cases") create(
    @Headers("authorization") h: string,
    @Body() b: unknown,
  ) {
    return service.createCase(service.actor(h), b);
  }
  @Get("cases/:id") detail(
    @Headers("authorization") h: string,
    @Param("id") id: string,
  ) {
    return service.detail(service.actor(h), id);
  }
  @Post("cases/:id/images") upload(
    @Headers("authorization") h: string,
    @Param("id") id: string,
    @Req() req: Request,
  ) {
    return service.image(service.actor(h), id, req.body);
  }
  @Get("cases/:id/images/:image") image(
    @Headers("authorization") h: string,
    @Param("id") id: string,
    @Param("image") image: string,
    @Res() res: Response,
  ) {
    res.setHeader("Cache-Control", "private, no-store");
    res.type("image/jpeg").send(service.readImage(service.actor(h), id, image));
  }
  @Post("cases/:id/analysis") analysis(
    @Headers("authorization") h: string,
    @Param("id") id: string,
  ) {
    return service.queue(service.actor(h), id);
  }
  @Post("cases/:id/retry") retry(
    @Headers("authorization") h: string,
    @Param("id") id: string,
  ) {
    return service.retry(service.actor(h), id);
  }
  @Post("cases/:id/review") review(
    @Headers("authorization") h: string,
    @Param("id") id: string,
  ) {
    return service.requestReview(service.actor(h), id);
  }
  @Post("cases/:id/follow-ups") follow(
    @Headers("authorization") h: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return service.followup(service.actor(h), id, b);
  }
  @Get("reminders") reminders(@Headers("authorization") h: string) {
    return service.reminders(service.actor(h));
  }
  @Post("reminders") reminder(
    @Headers("authorization") h: string,
    @Body() b: unknown,
  ) {
    return service.reminder(service.actor(h), b);
  }
  @Get("advice") advice() {
    return service.advice();
  }
  @Get("advisor/cases") assigned(@Headers("authorization") h: string) {
    return service.listCases(service.actor(h), "advisor");
  }
  @Post("advisor/cases/:id/response") response(
    @Headers("authorization") h: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return service.respond(service.actor(h), id, b);
  }
  @Get("admin/cases") all(@Headers("authorization") h: string) {
    return service.listCases(service.actor(h), "admin");
  }
  @Post("admin/cases/:id/assignment") assign(
    @Headers("authorization") h: string,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return service.assign(service.actor(h), id, b);
  }
  @Get("admin/users") users(@Headers("authorization") h: string) {
    return service.users(service.actor(h));
  }
  @Get("admin/audit") audit(@Headers("authorization") h: string) {
    return service.audit(service.actor(h));
  }
  @Get("admin/advice") content(@Headers("authorization") h: string) {
    const a = service.actor(h);
    if (!a.roles.some((r) => r === "admin" || r === "reviewer"))
      service.role(a, "reviewer");
    return service.advice(a);
  }
  @Post("admin/advice") draft(
    @Headers("authorization") h: string,
    @Body() b: unknown,
  ) {
    return service.createAdvice(service.actor(h), b);
  }
  @Post("admin/advice/:id/publish") publish(
    @Headers("authorization") h: string,
    @Param("id") id: string,
  ) {
    return service.publish(service.actor(h), id);
  }
}
@Module({ controllers: [ApiController] })
class AppModule {}
async function bootstrap() {
  assertConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: "64kb" }));
  app.use(
    raw({
      type: ["image/jpeg", "image/png", "application/octet-stream"],
      limit: "8mb",
    }),
  );
  app.enableCors({
    origin: (process.env.WEB_ORIGIN || "http://localhost:5173").split(","),
  });
  app.useGlobalFilters(new Errors());
  await app.listen(Number(process.env.PORT || 4100), "0.0.0.0");
}
void bootstrap();
