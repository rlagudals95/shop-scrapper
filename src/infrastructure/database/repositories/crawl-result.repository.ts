import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlSessionOrmEntity, ListingProductOrmEntity } from '../entities';
import { ListingData } from '@/domain/entities';
import { SiteType } from '@/domain/interfaces';

/**
 * 크롤링 결과 저장소 (Listing 전용)
 */
@Injectable()
export class CrawlResultRepository {
  constructor(
    @InjectRepository(CrawlSessionOrmEntity)
    private readonly sessionRepo: Repository<CrawlSessionOrmEntity>,
    @InjectRepository(ListingProductOrmEntity)
    private readonly productRepo: Repository<ListingProductOrmEntity>,
  ) {}

  /**
   * Listing 크롤링 결과 저장 (세션 + 상품 목록)
   */
  async saveListingResult(
    site: SiteType,
    keyword: string,
    listingUrl: string,
    rawHtml: string,
    listingData: ListingData,
  ): Promise<{ session: CrawlSessionOrmEntity; products: ListingProductOrmEntity[] }> {
    // 세션 생성
    const session = this.sessionRepo.create({
      site,
      keyword,
      listingUrl,
      rawHtml,
      success: true,
      productCount: listingData.products.length,
    });
    const savedSession = await this.sessionRepo.save(session);

    // 상품 저장
    const productEntities = listingData.products.map((p) =>
      this.productRepo.create({
        sessionId: savedSession.id,
        name: p.name,
        price: p.price,
        url: p.url,
        thumbnail: p.thumbnail ?? undefined,
        pdpCrawled: false,
      }),
    );
    const savedProducts = await this.productRepo.save(productEntities);

    return { session: savedSession, products: savedProducts };
  }

  /**
   * 실패한 세션 저장
   */
  async saveFailedSession(
    site: SiteType,
    keyword: string,
    error: string,
  ): Promise<CrawlSessionOrmEntity> {
    const session = this.sessionRepo.create({
      site,
      keyword,
      success: false,
      error,
      productCount: 0,
    });
    return this.sessionRepo.save(session);
  }

  /**
   * 세션 조회
   */
  async findSessionById(id: number): Promise<CrawlSessionOrmEntity | null> {
    return this.sessionRepo.findOne({
      where: { id },
      relations: ['products'],
    });
  }

  /**
   * 키워드로 최근 성공 세션 조회
   */
  async findRecentSuccessSession(
    site: SiteType,
    keyword: string,
  ): Promise<CrawlSessionOrmEntity | null> {
    return this.sessionRepo.findOne({
      where: { site, keyword, success: true },
      order: { createdAt: 'DESC' },
      relations: ['products'],
    });
  }

  /**
   * 세션의 상품 목록 조회
   */
  async findProductsBySessionId(sessionId: number): Promise<ListingProductOrmEntity[]> {
    return this.productRepo.find({
      where: { sessionId },
      order: { id: 'ASC' },
    });
  }

  /**
   * 최근 세션 목록 조회
   */
  async findRecentSessions(limit: number = 10): Promise<CrawlSessionOrmEntity[]> {
    return this.sessionRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }
}
