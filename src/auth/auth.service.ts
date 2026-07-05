import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { DatabaseService } from '../database/database.service';
import { users } from '../database/schema';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.databaseService.db.query.users.findFirst({
      where: eq(users.email, registerDto.email),
    });

    if (existingUser) {
      throw new ConflictException('Email is already in use');
    }

    const passwordHash = await argon2.hash(registerDto.password);

    const [createdUser] = await this.databaseService.db
      .insert(users)
      .values({
        email: registerDto.email,
        passwordHash,
      })
      .returning({ id: users.id, email: users.email });

    return createdUser;
  }

  async login(loginDto: LoginDto): Promise<string> {
    const user = await this.databaseService.db.query.users.findFirst({
      where: eq(users.email, loginDto.email),
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await argon2.verify(
      user.passwordHash,
      loginDto.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };

    return this.jwtService.signAsync(payload);
  }
}
