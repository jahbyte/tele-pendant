import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ResolveCodeDto {
  @ApiProperty({ example: 'TP-P03A21' })
  @IsString()
  @MinLength(2)
  code!: string;
}
