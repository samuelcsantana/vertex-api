import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { createProjectSchema } from './dto/create-project.dto';
import type { CreateProjectDto } from './dto/create-project.dto';
import { updateProjectSchema } from './dto/update-project.dto';
import type { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async findAll() {
    return this.projectsService.findAll();
  }

  @Get(':id')
  async findById(@Param('id') id: string) {
    return this.projectsService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async create(
    @Body(new ZodValidationPipe(createProjectSchema))
    createProjectDto: CreateProjectDto,
  ) {
    return this.projectsService.create(createProjectDto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSchema))
    updateProjectDto: UpdateProjectDto,
  ) {
    return this.projectsService.update(id, updateProjectDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiCookieAuth('access_token')
  async remove(@Param('id') id: string) {
    return this.projectsService.remove(id);
  }
}
