import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class SupportRequestDto {
  @IsOptional()
  @IsString()
  initData?: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsBoolean()
  isSecurityReport?: boolean;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class ReplyRequestDto {
  @IsOptional()
  @IsString()
  initData?: string;

  @IsString()
  requestId: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}

export class GetRequestsDto {
  @IsOptional()
  @IsString()
  initData?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  userId?: string;
}
