import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { ListingProductOrmEntity } from './listing-product.orm-entity';

/**
 * 크롤링 세션 Entity
 *
 * 검색어 기반 크롤링 세션을 저장
 * 하나의 세션에 여러 상품(ListingProduct)이 연결됨
 */
@Entity('crawl_sessions')
@Index(['site', 'keyword'])
export class CrawlSessionOrmEntity {
  @PrimaryGeneratedColumn()
  id: number;

  /** 사이트 타입 (coupang, naver 등) */
  @Column()
  site: string;

  /** 검색어 */
  @Column()
  keyword: string;

  /** 최종 URL */
  @Column({ type: 'text', nullable: true })
  listingUrl: string;

  /** 원본 HTML */
  @Column({ type: 'text', nullable: true })
  rawHtml: string;

  /** 추출된 상품 수 */
  @Column({ default: 0 })
  productCount: number;

  /** 성공 여부 */
  @Column({ default: false })
  success: boolean;

  /** 에러 메시지 */
  @Column({ type: 'text', nullable: true })
  error: string;

  /** 세션에 속한 상품들 */
  @OneToMany(() => ListingProductOrmEntity, (product) => product.session)
  products: ListingProductOrmEntity[];

  @CreateDateColumn()
  createdAt: Date;
}
