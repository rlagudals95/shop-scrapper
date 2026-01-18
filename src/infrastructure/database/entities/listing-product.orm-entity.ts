import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { CrawlSessionOrmEntity } from './crawl-session.orm-entity';

/**
 * Listing 페이지에서 추출한 상품 Entity
 *
 * Listing 페이지에서 추출한 기본 상품 정보
 */
@Entity('listing_products')
@Index(['sessionId'])
@Index(['url'])
export class ListingProductOrmEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** 세션 ID (FK) */
  @Column()
  sessionId: number;

  /** 상품명 (Listing에서 추출) */
  @Column({ type: 'text' })
  name: string;

  /** 가격 (Listing에서 추출) */
  @Column()
  price: string;

  /** 상품 URL */
  @Column({ type: 'text' })
  url: string;

  /** 썸네일 이미지 URL */
  @Column({ type: 'text', nullable: true })
  thumbnail: string;

  /** PDP 크롤링 완료 여부 */
  @Column({ default: false })
  pdpCrawled: boolean;

  /** 세션 연결 */
  @ManyToOne(() => CrawlSessionOrmEntity, (session) => session.products)
  @JoinColumn({ name: 'sessionId' })
  session: CrawlSessionOrmEntity;

  @CreateDateColumn()
  createdAt: Date;
}
