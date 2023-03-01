import Parchment from '../parchment/dist/parchment';
import Block, { BlockEmbed } from './block';


class Container extends Parchment.Container { }
Container.allowedChildren = [Block, BlockEmbed, Container];


export default Container;
