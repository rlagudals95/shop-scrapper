import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PageType } from '@/domain/entities';

@Entity('selector_cache')
@Index(['siteDomain', 'pageType'], { unique: true })
export class SelectorCacheOrmEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  siteDomain: string;

  @Column({ type: 'varchar' })
  pageType: PageType;

  @Column({ type: 'text' })
  selectorsJson: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

// Backward compatibility alias
/** @deprecated Use SelectorCacheOrmEntity instead */
export const XPathCacheOrmEntity = SelectorCacheOrmEntity;
