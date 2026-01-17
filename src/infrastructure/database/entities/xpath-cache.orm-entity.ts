import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PageType } from '@/domain/entities';

@Entity('xpath_cache')
@Index(['siteDomain', 'pageType'], { unique: true })
export class XPathCacheOrmEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  siteDomain: string;

  @Column({ type: 'varchar' })
  pageType: PageType;

  @Column({ type: 'text' })
  xpathsJson: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
