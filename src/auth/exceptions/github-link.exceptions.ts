import { ConflictException } from '@nestjs/common';

export class GithubAlreadyLinkedException extends ConflictException {
  constructor() {
    super('Este perfil do GitHub já está vinculado a outra conta.');
  }
}

export class GithubEmailConflictException extends ConflictException {
  constructor() {
    super(
      'Este e-mail já está associado a uma conta Google. Faça login com o Google e conecte o GitHub nas definições do seu perfil.',
    );
  }
}
