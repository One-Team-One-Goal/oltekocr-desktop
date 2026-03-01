import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: {
          url: `file:${process.cwd()}/data/oltekocr.db`,
        },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    // Enable WAL mode for better concurrent read performance
    await this.$queryRawUnsafe("PRAGMA journal_mode = WAL");
    await this.$queryRawUnsafe("PRAGMA foreign_keys = ON");
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
