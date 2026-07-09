import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { aboutContent } from '../database/schema';
import { UpdateAboutDto } from './dto/update-about.dto';

@Injectable()
export class AboutService {
  constructor(private readonly databaseService: DatabaseService) {}

  async get() {
    const existing =
      await this.databaseService.db.query.aboutContent.findFirst();

    if (existing) {
      return existing;
    }

    const [created] = await this.databaseService.db
      .insert(aboutContent)
      .values({ content: '' })
      .returning();

    return created;
  }

  async update(updateAboutDto: UpdateAboutDto) {
    const existing =
      await this.databaseService.db.query.aboutContent.findFirst();

    if (!existing) {
      const [created] = await this.databaseService.db
        .insert(aboutContent)
        .values(updateAboutDto)
        .returning();

      return created;
    }

    const [updated] = await this.databaseService.db
      .update(aboutContent)
      .set({ ...updateAboutDto, updatedAt: new Date() })
      .where(eq(aboutContent.id, existing.id))
      .returning();

    return updated;
  }
}
