import { Controller, Get, Res } from "@nestjs/common";
import { AppService } from "./app.service";
import express from "express";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getLanding(@Res() res: express.Response) {
    res.setHeader("Content-Type", "text/html");
    res.send(this.appService.getLandingPage());
    return res;
  }
}
