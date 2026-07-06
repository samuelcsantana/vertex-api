import { Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { topics } from '../database/schema';
import { slugify } from '../common/utils/slugify.util';
import { CreateTopicDto } from './dto/create-topic.dto';

@Injectable()
export class TopicsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(createTopicDto: CreateTopicDto) {
    const [createdTopic] = await this.databaseService.db
      .insert(topics)
      .values({
        name: createTopicDto.name,
        slug: slugify(createTopicDto.name),
      })
      .returning();

    return createdTopic;
  }

  async findAll() {
    return this.databaseService.db.query.topics.findMany({
      orderBy: asc(topics.name),
    });
  }

  async update(id: string, updateTopicDto: CreateTopicDto) {
    const [updatedTopic] = await this.databaseService.db
      .update(topics)
      .set({
        name: updateTopicDto.name,
        slug: slugify(updateTopicDto.name),
      })
      .where(eq(topics.id, id))
      .returning();

    if (!updatedTopic) {
      throw new NotFoundException('Topic not found');
    }

    return updatedTopic;
  }

  async remove(id: string) {
    const [deletedTopic] = await this.databaseService.db
      .delete(topics)
      .where(eq(topics.id, id))
      .returning();

    if (!deletedTopic) {
      throw new NotFoundException('Topic not found');
    }

    return deletedTopic;
  }
}
