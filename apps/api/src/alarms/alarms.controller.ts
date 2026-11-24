import {
  Inject,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ApiAuth } from '../common/swagger/api-auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtPayload } from '../auth/providers/auth.service';
import { JwtAuthGuard } from '../auth/providers/jwt-auth.guard';
import { RolesGuard } from '../auth/providers/roles.guard';
import { SkipDataWrap } from '../common/swagger/skip-data-wrap.decorator';
import { UserRole } from '../users/enums/user-role.enum';
import { auditActorFromRequest } from '../common/audit-actor';
import {
  AlarmEngineService,
  parseAlarmHistoryHours,
} from './providers/alarm-engine.service';
import {
  SaveAlarmDefinitionDto,
  UpdateAlarmDefinitionDto,
} from './dtos/save-alarm-definition.dto';

@ApiTags('alarms')
@Controller('alarms')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiAuth()
export class AlarmsController {
  constructor(
    @Inject(AlarmEngineService) private readonly alarms: AlarmEngineService,
  ) {}

  @Get()
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'List active/acked/shelved alarms' })
  list() {
    return this.alarms.listActive();
  }

  @Get('history')
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({
    summary: 'Alarm history for a time window (includes cleared)',
  })
  history(@Query('hours') hours?: string) {
    return this.alarms.listHistory(parseAlarmHistoryHours(hours));
  }

  @Get('summary')
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Alarm frequency ranking for a time window' })
  summary(@Query('hours') hours?: string) {
    return this.alarms.summarize(parseAlarmHistoryHours(hours));
  }

  @Get('history.csv')
  @SkipDataWrap()
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Export alarm history as CSV' })
  async historyCsv(@Res() res: Response, @Query('hours') hours?: string) {
    const windowHours = parseAlarmHistoryHours(hours);
    const csv = await this.alarms.historyCsv(windowHours);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="alarms-${stamp}.csv"`,
    );
    res.send(csv);
  }

  @Get('definitions')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'List alarm definitions' })
  definitions() {
    return this.alarms.listDefinitions();
  }

  @Post('definitions')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create an alarm definition' })
  createDefinition(
    @Body() body: SaveAlarmDefinitionDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.alarms.createDefinition({
      ...body,
      actor: auditActorFromRequest(req.user, req.ip),
    });
  }

  @Patch('definitions/:id')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update an alarm definition' })
  updateDefinition(
    @Param('id') id: string,
    @Body() body: UpdateAlarmDefinitionDto,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.alarms.updateDefinition(id, {
      ...body,
      actor: auditActorFromRequest(req.user, req.ip),
    });
  }

  @Delete('definitions/:id')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete an alarm definition' })
  deleteDefinition(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.alarms.deleteDefinition(
      id,
      auditActorFromRequest(req.user, req.ip),
    );
  }

  @Post(':id/ack')
  @Roles(UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Acknowledge alarm' })
  ack(@Param('id') id: string, @Req() req: Request & { user: JwtPayload }) {
    return this.alarms.ack(id, auditActorFromRequest(req.user, req.ip));
  }

  @Post(':id/shelve')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Shelve alarm' })
  shelve(@Param('id') id: string, @Req() req: Request & { user: JwtPayload }) {
    return this.alarms.shelve(id, auditActorFromRequest(req.user, req.ip));
  }

  @Post(':id/unshelve')
  @Roles(UserRole.SUPERVISOR, UserRole.ADMIN)
  @ApiOperation({ summary: 'Return a shelved alarm to active' })
  unshelve(
    @Param('id') id: string,
    @Req() req: Request & { user: JwtPayload },
  ) {
    return this.alarms.unshelve(id, auditActorFromRequest(req.user, req.ip));
  }
}
