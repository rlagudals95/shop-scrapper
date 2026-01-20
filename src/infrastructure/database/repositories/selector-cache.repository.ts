import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ISelectorRepository } from '@/domain/interfaces';
import { PageType, SelectorCache, SelectorMap } from '@/domain/entities';
import { SelectorCacheOrmEntity } from '../entities/selector-cache.orm-entity';

@Injectable()
export class SelectorCacheRepository implements ISelectorRepository {
  constructor(
    @InjectRepository(SelectorCacheOrmEntity)
    private readonly repository: Repository<SelectorCacheOrmEntity>,
  ) {}

  async findByDomain(domain: string, pageType: PageType): Promise<SelectorCache | null> {
    const entity = await this.repository.findOne({
      where: { siteDomain: domain, pageType },
    });

    if (!entity) return null;

    return this.toSelectorCache(entity);
  }

  async upsert(domain: string, pageType: PageType, selectors: SelectorMap): Promise<SelectorCache> {
    let entity = await this.repository.findOne({
      where: { siteDomain: domain, pageType },
    });

    if (entity) {
      entity.selectorsJson = JSON.stringify(selectors);
      entity = await this.repository.save(entity);
    } else {
      entity = await this.repository.save({
        siteDomain: domain,
        pageType,
        selectorsJson: JSON.stringify(selectors),
      });
    }

    return this.toSelectorCache(entity);
  }

  async invalidate(domain: string, pageType?: PageType): Promise<void> {
    if (pageType) {
      await this.repository.delete({ siteDomain: domain, pageType });
    } else {
      await this.repository.delete({ siteDomain: domain });
    }
  }

  async findAll(): Promise<SelectorCache[]> {
    const entities = await this.repository.find();
    return entities.map((e) => this.toSelectorCache(e));
  }

  async clearAll(): Promise<void> {
    await this.repository.clear();
  }

  private toSelectorCache(entity: SelectorCacheOrmEntity): SelectorCache {
    return {
      id: entity.id,
      siteDomain: entity.siteDomain,
      pageType: entity.pageType,
      selectors: JSON.parse(entity.selectorsJson),
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}

// Backward compatibility alias
/** @deprecated Use SelectorCacheRepository instead */
export const XPathCacheRepository = SelectorCacheRepository;
