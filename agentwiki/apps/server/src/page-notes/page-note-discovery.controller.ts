import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { Principal } from '../core/authorization/authorization.service';
import { PageNoteService } from './page-note.service';

@Controller('page-notes')
@UseGuards(CombinedAuthGuard)
export class PageNoteDiscoveryController {
  constructor(private readonly notes: PageNoteService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @Req() request: Request) {
    return this.notes.discover(request.user as Principal, query);
  }
}
