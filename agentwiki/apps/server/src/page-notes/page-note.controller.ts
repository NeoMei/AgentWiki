import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CombinedAuthGuard } from '../core/auth/combined-auth.guard';
import { Principal } from '../core/authorization/authorization.service';
import { PageNoteService } from './page-note.service';

@Controller('spaces/:spaceId/pages/:pageId/notes')
@UseGuards(CombinedAuthGuard)
export class PageNoteController {
  constructor(private readonly notes: PageNoteService) {}

  @Get()
  list(@Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Req() req: Request) {
    return this.notes.list(req.user as Principal, spaceId, pageId);
  }

  @Post()
  create(@Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Body() body: unknown, @Req() req: Request) {
    return this.notes.create(req.user as Principal, spaceId, pageId, body);
  }

  @Patch(':noteId')
  update(@Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Param('noteId') noteId: string, @Body() body: unknown, @Req() req: Request) {
    return this.notes.update(req.user as Principal, spaceId, pageId, noteId, body);
  }

  @Delete(':noteId')
  remove(@Param('spaceId') spaceId: string, @Param('pageId') pageId: string, @Param('noteId') noteId: string, @Body() body: unknown, @Req() req: Request) {
    return this.notes.remove(req.user as Principal, spaceId, pageId, noteId, body);
  }
}
