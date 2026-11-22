import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header,
  HttpCode, NotFoundException, Post, Query, Req, Res, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

import { PrismaService } from '../../../database/prisma.service';
import { RedisService } from '../../../database/redis.service';
import { AuthService } from '../auth.service';
import { agentWikiReturnTo, type NativeProof, type UniHubIdentity, UniHubClient, UniHubRuntimeError } from './unihub-client';
import { UniHubSessionService } from './unihub-session.service';
import { persistUniHubEnrollmentIntent } from './unihub-lifecycle.service';
import { fingerprintNativeJwt, type UniHubNativeBrowserProof, UniHubNativeSessionService } from './unihub-native-session.service';

const cookieName = 'agentwiki_unihub_flow';
const cookiePath = '/api/auth/unihub';
const flowExpiry = 300;
const secret = () => randomBytes(32).toString('base64url');

interface Credential {
  sub: string;
  authVersion?: number;
  iat?: number;
  exp?: number;
  unihubSid?: string;
  nativeFingerprint?: string;
}
interface BrowserProof {
  state: string;
  nonce: string;
  verifier: string;
}
type Flow = ({ mode: 'sso'; returnTo: string } & BrowserProof)
  | ({ mode: 'link'; userId: string; epoch: number; linkId: string } & BrowserProof)
  | { mode: 'handoff'; state: string; userId: string; epoch: number; nativeSession: UniHubNativeBrowserProof };
type SavedFlow = Flow & { code?: string; generation: string };
type IdentitySession = { identity: UniHubIdentity; source_proof_token: string; source_proof_expires_at: number };

class NativeRequest {
  @IsIn(['auto', 'enroll', 'link', 'open'])
  mode!: 'auto' | 'enroll' | 'link' | 'open';

  @IsOptional()
  @IsString()
  @MaxLength(512)
  password?: string;
}

class FinishRequest {
  @IsIn(['link', 'sso'])
  mode!: 'link' | 'sso';

  @IsString()
  @Matches(/^[a-f0-9]{64}$/)
  confirmationId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  centralUserId?: string;

  @IsOptional()
  @IsBoolean()
  requireSameUser?: boolean;

  @IsOptional()
  @IsBoolean()
  confirmAccountSwitch?: boolean;
}

@Controller('auth/unihub')
export class UniHubController {
  constructor(
    private readonly client: UniHubClient,
    private readonly redis: RedisService,
    private readonly sessions: UniHubSessionService,
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly nativeSessions: UniHubNativeSessionService,
  ) {}

  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status(@Req() request: Request) {
    if (!this.client.enabled || !this.client.hasPilotUsers) return { enabled: false };
    const credential = this.bearer(request);
    if (!credential) return { enabled: true };
    const actor = await this.auth.validateJwtUser(credential.sub, credential.unihubSid, credential.nativeFingerprint);
    if (!actor || actor.mustChangePassword || (credential.authVersion !== undefined && credential.authVersion !== actor.authVersion)) {
      return { enabled: true };
    }
    if (!this.client.allowsLocalUser(actor.userId)) return { enabled: false };
    return { enabled: true, bound: Boolean(await this.sessions.findBinding(actor.userId)) };
  }

  @Get('start')
  async start(@Query('returnTo') returnTo: unknown, @Res() response: Response) {
    this.requireEnabled();
    const proof = this.newProof();
    await this.save(response, { mode: 'sso', ...proof, returnTo: agentWikiReturnTo(returnTo) });
    response.redirect(303, this.client.browserURL('/auth/product/authorize', {
      client_id: this.client.clientId, redirect_uri: this.client.callbackURL,
      state: proof.state, nonce: proof.nonce, code_challenge: this.challenge(proof.verifier), code_challenge_method: 'S256',
    }));
  }

  @Post('native')
  @HttpCode(200)
  async native(@Body() input: NativeRequest, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.requireEnabled();
    const credential = this.bearer(request);
    const automatic = input.mode === 'auto';
    if (credential?.unihubSid && (automatic || input.mode === 'open')) {
      const actor = await this.auth.validateJwtUser(credential.sub, credential.unihubSid, credential.nativeFingerprint);
      if (!actor || actor.mustChangePassword || actor.authVersion !== credential.authVersion) throw new UnauthorizedException();
      return { redirectUrl: this.client.browserURL('/console') };
    }
    const user = await this.nativeUser(credential);
    const epoch = user.authVersion + 1;
    if (input.mode === 'open' || (automatic && await this.sessions.findBinding(user.id))) {
      const proof = await this.trackNative(credential, user.id);
      return this.beginHandoff(response, user.id, epoch, proof);
    }

    const recentLogin = Boolean(credential?.iat && Date.now() / 1000 - credential.iat <= 55);
    if (automatic) {
      if (!user.password || credential?.authVersion !== user.authVersion || (user.platformRole === 'super_admin' && !recentLogin)) {
        throw new UnauthorizedException('AgentWiki original login required');
      }
    } else if (input.password !== undefined) {
      if (!user.password || !await this.auth.validatePassword(input.password, user.password)) {
        throw new UnauthorizedException('AgentWiki password verification failed');
      }
    } else if (!recentLogin || !user.password) {
      throw new UnauthorizedException('Confirm your AgentWiki password');
    }
    const nativeProof = await this.trackNative(credential, user.id);
    const authentication = this.authentication(user.id, epoch, automatic && user.platformRole !== 'super_admin' ? 'session' : 'password');
    if (automatic || input.mode === 'enroll') {
      if (!await persistUniHubEnrollmentIntent(this.prisma, user.id, user.authVersion)) throw new UnauthorizedException('AgentWiki user is unavailable');
      const result = await this.call<UniHubIdentity>('/enroll', {
        client_id: this.client.clientId, authentication, display_name: user.name ?? '', email: user.email,
        ...(automatic ? { automatic: true } : {}),
      });
      await this.bind(result, user.id, epoch);
      return this.beginHandoff(response, user.id, epoch, nativeProof);
    }

    const proof = this.newProof();
    const result = await this.call<{ link_id: string; authorize_url: string }>('/link/start', {
      client_id: this.client.clientId, state: proof.state, nonce: proof.nonce, code_challenge: this.challenge(proof.verifier), authentication,
    });
    if (!/^[A-Za-z0-9_-]{43}$/.test(result.link_id)) throw new ServiceUnavailableException('Invalid UniHub response');
    await this.save(response, { mode: 'link', ...proof, userId: user.id, epoch, linkId: result.link_id });
    return { redirectUrl: this.client.checkBrowserURL(result.authorize_url, '/auth/product/link') };
  }

  @Get('callback')
  async callback(@Req() request: Request, @Res() response: Response) {
    this.requireEnabled();
    this.privateResponse(response);
    const saved = await this.read(request);
    if (!saved || request.query.state !== saved.flow.state || saved.flow.code) throw new BadRequestException('Invalid UniHub handoff');
    if (!await this.redis.deleteIfValueMatches(saved.key, saved.raw)) throw new BadRequestException('Expired UniHub handoff');
    if (request.query.error) {
      const target = saved.flow.mode === 'sso' ? '&returnTo=' + encodeURIComponent(saved.flow.returnTo) : '';
      response.redirect(303, '/unihub?error=login' + target);
      return;
    }
    const flow = saved.flow;
    if (flow.mode === 'handoff') {
      if (request.query.handoff_done === '1') {
        response.redirect(303, this.client.browserURL('/console'));
        return;
      }
      const handoff = request.query.handoff;
      if (typeof handoff !== 'string' || !/^upa_[a-f0-9]{64}$/.test(handoff)) throw new BadRequestException('Invalid UniHub handoff');
      const user = await this.nativeUser({ sub: flow.userId, authVersion: flow.epoch - 1 });
      if (!flow.nativeSession || !await this.nativeSessions.active(user.id, flow.nativeSession.id)) {
        throw new UnauthorizedException('AgentWiki source session ended');
      }
      const actor = await this.call<UniHubIdentity & { actor_token?: string }>('/authenticate',
        this.authentication(user.id, flow.epoch, 'session'));
      if (!actor.actor_token || actor.binding.local_user_id !== user.id) throw new ForbiddenException('UniHub binding unavailable');
      const approved = await this.call<{ finish_url: string }>('/browser/approve', {
        client_id: this.client.clientId, handoff_id: handoff, state: flow.state,
        native_session_id: flow.nativeSession.id, native_session_expires_at: flow.nativeSession.expiresAt,
        native_handoff_generation: this.client.sessionGeneration,
      }, actor.actor_token);
      await this.redis.setStrict(saved.key, saved.raw, 120);
      response.redirect(303, this.client.checkBrowserURL(approved.finish_url, '/auth/product/finish'));
      return;
    }
    const expectedRoute = flow.mode === 'link' ? 'link' : 'broker';
    const code = request.query.code;
    if (request.query[expectedRoute] !== '1' || typeof code !== 'string' || code.length < 43 || code.length > 80 ||
        !/^[A-Za-z0-9_-]+$/.test(code)) throw new BadRequestException('Invalid UniHub authorization response');
    await this.redis.setStrict(saved.key, JSON.stringify({ ...flow, code }), 120);
    const target = flow.mode === 'sso' ? '&returnTo=' + encodeURIComponent(flow.returnTo) : '';
    response.redirect(303, '/unihub?continue=1&flow=' + saved.confirmationId + target);
  }

  @Post('finish')
  @HttpCode(200)
  async finish(@Body() input: FinishRequest, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.requireEnabled();
    this.privateResponse(response);
    const saved = await this.read(request);
    if (!saved?.flow.code || saved.flow.mode === 'handoff') throw new BadRequestException('No pending UniHub login');
    if (input?.confirmationId !== saved.confirmationId || input.mode !== saved.flow.mode) {
      throw new ConflictException('UniHub browser flow changed');
    }
    const flow = saved.flow;
    const exchange = this.exchange(flow);
    if (flow.mode === 'link') {
      const credential = this.bearer(request);
      const user = await this.nativeUser(credential);
      if (user.id !== flow.userId || user.authVersion + 1 !== flow.epoch) throw new ForbiddenException('AgentWiki account changed');
      if (!input?.centralUserId) throw new BadRequestException('Confirm the selected UniHub account');
      const nativeProof = await this.trackNative(credential, user.id);
      if (!await this.redis.deleteIfValueMatches(saved.key, saved.raw)) throw new BadRequestException('Expired UniHub login');
      const authentication = this.authentication(user.id, flow.epoch, 'session');
      if (!await persistUniHubEnrollmentIntent(this.prisma, user.id, user.authVersion)) throw new UnauthorizedException('AgentWiki user is unavailable');
      const result = await this.call<UniHubIdentity>('/link/complete', {
        ...exchange, link_id: flow.linkId, central_user_id: input.centralUserId, authentication,
      });
      await this.bind(result, user.id, flow.epoch);
      return this.beginHandoff(response, user.id, flow.epoch, nativeProof);
    }

    const current = this.bearer(request);
    const active = await this.currentActor(current);
    if (input.requireSameUser && !active) {
      throw new UnauthorizedException('AgentWiki session changed');
    }
    if (!await this.redis.deleteIfValueMatches(saved.key, saved.raw)) throw new BadRequestException('Expired UniHub login');
    const result = await this.call<IdentitySession>('/session/exchange', exchange);
    const identity = result.identity;
    const user = await this.nativeUser({ sub: identity.binding.local_user_id, authVersion: identity.auth_version - 1 });
    const sameUser = active?.userId === user.id && active.authVersion === user.authVersion;
    if (!sameUser && (input.requireSameUser || (active && !input.confirmAccountSwitch))) {
      throw new ConflictException('Confirm the AgentWiki account switch');
    }
    await this.bind(identity, user.id, user.authVersion + 1);
    if (sameUser && !current?.unihubSid) return { returnTo: flow.returnTo };
    const local = await this.sessions.open(user.id, identity.binding.user_id, result.source_proof_token, result.source_proof_expires_at);
    return {
      access_token: this.auth.signToken(user, local),
      user: { id: user.id, email: user.email, name: user.name, type: user.type, platformRole: user.platformRole, authSource: 'unihub' },
      returnTo: flow.returnTo,
    };
  }

  @Get('pending')
  @Header('Cache-Control', 'no-store')
  async pending(@Req() request: Request) {
    this.requireEnabled();
    const saved = await this.read(request);
    if (!saved?.flow.code || saved.flow.mode === 'handoff') throw new BadRequestException('No pending UniHub login');
    if (request.query.flow !== saved.confirmationId) throw new ConflictException('UniHub browser flow changed');
    const flow = saved.flow;
    if (flow.mode === 'sso') {
      const result = { mode: 'sso' as const, confirmationId: saved.confirmationId, returnTo: flow.returnTo };
      const actor = await this.currentActor(this.bearer(request));
      if (!actor || !this.client.allowsLocalUser(actor.userId)) return result;
      try {
        const { matches } = await this.call<{ matches: boolean }>('/session/matches', {
          ...this.exchange(flow), local_user_id: actor.userId,
        });
        if (matches === true) return { ...result, sameUser: true };
      } catch {
        // Explicit SSO confirmation is available when the account match cannot be checked.
      }
      return result;
    }
    const user = await this.nativeUser(this.bearer(request));
    if (user.id !== flow.userId || user.authVersion + 1 !== flow.epoch) throw new ForbiddenException('AgentWiki account changed');
    const preview = await this.call<{ central_user_id: string; display_name: string; masked_email: string }>('/link/preview', {
      ...this.exchange(flow), link_id: flow.linkId, authentication: this.authentication(user.id, flow.epoch, 'session'),
    });
    if (!preview.central_user_id) throw new ServiceUnavailableException('UniHub account preview unavailable');
    return {
      mode: 'link',
      confirmationId: saved.confirmationId,
      localEmail: user.email.replace(/^(.).*(@.+)$/u, '$1***$2'),
      centralUserId: preview.central_user_id,
      displayName: preview.display_name,
      maskedEmail: preview.masked_email || '…' + preview.central_user_id.slice(-8),
    };
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const credential = this.bearer(request);
    if (credential?.unihubSid) {
      await this.sessions.revoke(credential.unihubSid, credential.sub);
    } else if (credential && this.client.lifecycleEnabled) {
      const proof = this.nativeProof(credential);
      if (proof) await this.nativeSessions.revoke(credential.sub, proof);
    }
    this.privateResponse(response);
    const saved = await this.read(request);
    if (saved) await this.redis.deleteIfValueMatches(saved.key, saved.raw);
  }

  private bearer(request: Request): Credential | null {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) return null;
    try {
      const token = header.slice(7);
      const payload = this.jwt.verify<Credential>(token);
      if (typeof payload.sub !== 'string' || !payload.sub) return null;
      return { ...payload, nativeFingerprint: payload.unihubSid === undefined ? fingerprintNativeJwt(token) : undefined };
    } catch {
      return null;
    }
  }

  private async currentActor(credential: Credential | null) {
    if (!credential) return null;
    const actor = await this.auth.validateJwtUser(credential.sub, credential.unihubSid, credential.nativeFingerprint);
    return actor && !actor.mustChangePassword &&
      (credential.authVersion === undefined ? !credential.unihubSid && actor.authVersion === 0 : credential.authVersion === actor.authVersion)
      ? actor : null;
  }

  private nativeProof(credential: Credential | null): UniHubNativeBrowserProof | null {
    const expiresAt = credential?.exp;
    if (!credential?.nativeFingerprint || typeof expiresAt !== 'number' || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000) return null;
    return { id: credential.nativeFingerprint, expiresAt };
  }

  private async trackNative(credential: Credential | null, userId: string): Promise<UniHubNativeBrowserProof> {
    const proof = this.nativeProof(credential);
    if (!proof || !await this.nativeSessions.track(userId, proof)) {
      throw new UnauthorizedException('AgentWiki source session ended');
    }
    return proof;
  }

  private async nativeUser(credential: Credential | null) {
    if (!credential || credential.unihubSid) throw new UnauthorizedException('AgentWiki original login required');
    if (!this.client.allowsLocalUser(credential.sub)) throw new ForbiddenException('UniHub sign-in is unavailable for this account');
    const user = await this.prisma.user.findUnique({ where: { id: credential.sub } });
    if (!user || user.type !== 'human' || user.lockedAt || user.deletedAt || user.mustChangePassword ||
        ((credential.authVersion ?? 0) !== user.authVersion)) {
      throw new UnauthorizedException('AgentWiki user is unavailable');
    }
    return user;
  }

  private async bind(identity: UniHubIdentity, userId: string, epoch: number) {
    if (identity.binding.local_user_id !== userId || !identity.binding.user_id || identity.auth_version !== epoch ||
        !identity.access.active || !identity.access.permissions.includes('product:use')) throw new ForbiddenException('UniHub binding unavailable');
    await this.nativeUser({ sub: userId, authVersion: epoch - 1 });
    await this.sessions.bind(userId, identity.binding.user_id, epoch);
  }

  private async call<T>(path: string, body: unknown, actor?: string): Promise<T> {
    try {
      return await this.client.request<T>(path, body, actor);
    } catch (error) {
      if (!(error instanceof UniHubRuntimeError)) throw error;
      if (error.status === 403) throw new ForbiddenException('UniHub access unavailable');
      if (error.status === 404 || error.status === 409) throw new ConflictException('UniHub identity binding is missing or conflicts');
      if (error.status === 400) throw new BadRequestException('Invalid UniHub identity request');
      throw new ServiceUnavailableException('UniHub is temporarily unavailable');
    }
  }

  private requireEnabled() {
    if (!this.client.enabled || !this.client.hasPilotUsers) throw new NotFoundException();
  }

  private newProof(): BrowserProof {
    return { state: secret(), nonce: secret(), verifier: secret() };
  }

  private challenge(verifier: string) {
    return createHash('sha256').update(verifier).digest('base64url');
  }

  private exchange(flow: BrowserProof & { code?: string }) {
    return {
      client_id: this.client.clientId, redirect_uri: this.client.callbackURL,
      code: flow.code, nonce: flow.nonce, code_verifier: flow.verifier,
    };
  }

  private authentication(userId: string, epoch: number, method: NativeProof['method']): NativeProof {
    return { local_user_id: userId, authentication_id: randomUUID(), auth_version: epoch, method, authenticated_at: Math.floor(Date.now() / 1000) };
  }

  private async beginHandoff(response: Response, userId: string, epoch: number, nativeSession: UniHubNativeBrowserProof) {
    if (!await this.sessions.findBinding(userId)) throw new ConflictException('AgentWiki account is not bound to UniHub');
    const state = secret();
    await this.save(response, { mode: 'handoff', state, userId, epoch, nativeSession });
    return { redirectUrl: this.client.browserURL('/auth/product/start', { client_id: this.client.clientId, state }) };
  }

  private async save(response: Response, flow: Flow) {
    this.privateResponse(response);
    const id = secret();
    const record: SavedFlow = { ...flow, generation: this.client.sessionGeneration };
    await this.redis.setStrict(this.flowKey(id), JSON.stringify(record), flowExpiry);
    response.cookie(cookieName, id, { ...this.cookieOptions(), maxAge: flowExpiry * 1000 });
  }

  private async read(request: Request) {
    const values = (request.headers.cookie ?? '').split(';').map(part => part.trim()).filter(part => part.startsWith(cookieName + '='));
    const id = values.length === 1 ? values[0].slice(cookieName.length + 1) : '';
    if (!/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
    const key = this.flowKey(id);
    const raw = await this.redis.getStrict(key);
    if (!raw) return null;
    const flow = JSON.parse(raw) as SavedFlow;
    if (flow.generation !== this.client.sessionGeneration) return null;
    return { key, raw, confirmationId: key.slice(-64), flow };
  }

  private flowKey(id: string) {
    return 'auth:unihub:browser:' + createHash('sha256').update(id).digest('hex');
  }

  private privateResponse(response: Response) {
    response.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  }

  private cookieOptions() {
    return { httpOnly: true, secure: this.client.callbackURL.startsWith('https:'), sameSite: 'lax' as const, path: cookiePath };
  }

}
