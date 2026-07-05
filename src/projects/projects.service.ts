import { Injectable, NotFoundException } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.service';
import { projects } from '../database/schema';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(private readonly databaseService: DatabaseService) {}

  async create(createProjectDto: CreateProjectDto) {
    const [createdProject] = await this.databaseService.db
      .insert(projects)
      .values(createProjectDto)
      .returning();

    return createdProject;
  }

  async findAll() {
    return this.databaseService.db.query.projects.findMany({
      orderBy: desc(projects.createdAt),
    });
  }

  async findById(id: string) {
    const project = await this.databaseService.db.query.projects.findFirst({
      where: eq(projects.id, id),
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async update(id: string, updateProjectDto: UpdateProjectDto) {
    const [updatedProject] = await this.databaseService.db
      .update(projects)
      .set({ ...updateProjectDto, updatedAt: new Date() })
      .where(eq(projects.id, id))
      .returning();

    if (!updatedProject) {
      throw new NotFoundException('Project not found');
    }

    return updatedProject;
  }

  async remove(id: string) {
    const [deletedProject] = await this.databaseService.db
      .delete(projects)
      .where(eq(projects.id, id))
      .returning();

    if (!deletedProject) {
      throw new NotFoundException('Project not found');
    }

    return deletedProject;
  }
}
