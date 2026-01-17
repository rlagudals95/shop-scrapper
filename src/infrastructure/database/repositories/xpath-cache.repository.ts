import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IXPathRepository } from '@/domain/interfaces';
import { PageType, XPathCache, XPathMap } from '@/domain/entities';
import { XPathCacheOrmEntity } from '../entities/xpath-cache.orm-entity';

@Injectable()
export class XPathCacheRepository implements IXPathRepository {
  constructor(
    @InjectRepository(XPathCacheOrmEntity)
    private readonly repository: Repository<XPathCacheOrmEntity>,
  ) {}

  async findByDomain(domain: string, pageType: PageType): Promise<XPathCache | null> {
    const entity = await this.repository.findOne({
      where: { siteDomain: domain, pageType },
    });

    if (!entity) return null;

    return this.toXPathCache(entity);
  }

  async upsert(domain: string, pageType: PageType, xpaths: XPathMap): Promise<XPathCache> {
    let entity = await this.repository.findOne({
      where: { siteDomain: domain, pageType },
    });

    if (entity) {
      entity.xpathsJson = JSON.stringify(xpaths);
      entity = await this.repository.save(entity);
    } else {
      entity = await this.repository.save({
        siteDomain: domain,
        pageType,
        xpathsJson: JSON.stringify(xpaths),
      });
    }

    return this.toXPathCache(entity);
  }

  async invalidate(domain: string, pageType?: PageType): Promise<void> {
    if (pageType) {
      await this.repository.delete({ siteDomain: domain, pageType });
    } else {
      await this.repository.delete({ siteDomain: domain });
    }
  }

  async findAll(): Promise<XPathCache[]> {
    const entities = await this.repository.find();
    return entities.map((e) => this.toXPathCache(e));
  }

  async clearAll(): Promise<void> {
    await this.repository.clear();
  }

  private toXPathCache(entity: XPathCacheOrmEntity): XPathCache {
    return {
      id: entity.id,
      siteDomain: entity.siteDomain,
      pageType: entity.pageType,
      xpaths: JSON.parse(entity.xpathsJson),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
