import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class SaveScanCodeDto {
  @ApiProperty({ example: 'TP-P03A21' })
  @IsString()
  @MinLength(1)
  code!: string;

  @ApiProperty({ example: 'P03A21 Operator' })
  @IsString()
  @MinLength(1)
  label!: string;

  @ApiPropertyOptional({ enum: ['asset', 'shortcut', 'other'] })
  @IsOptional()
  @IsIn(['asset', 'shortcut', 'other'])
  kind?: 'asset' | 'shortcut' | 'other';

  @ApiPropertyOptional({ example: '/operator' })
  @IsOptional()
  @IsString()
  routeHint?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string | null;
}
