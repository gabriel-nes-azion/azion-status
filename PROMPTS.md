PROMPTS
=======

plan: crie uma pagina usando o DESIGN.md. Use apenas html, js e css puros. O backend deve ser escrito em JS para executar em edge-functions na Azion.
Pode fazer o deploy usando o azion cli configurado neste terminal.
A pagina deverá ser um dashboard de status-page indicando se a conta do cliente está com os serviços funcionais ou algo de errado.
Baixe o projeto https://github.com/aziontech/azion-queries para obter exemplos de chamadas ao GraphQL da Azion.
O app deve funcionar da seguinte forma, ao entrar ele verifica se o cliente está logado.
Veja como o projeto ../azion-architect/ implementou o login com cookies ou personal tokens.
Além disso, verifique se existe o cookie azsid setado. Se estiver setado, tente acessar as APIs com ele.
Na pagina de status devemos mostrar indicadores de status do cliente de forma geral e nao por dominios.
Valide por exemplo o percentual de status 5xx ou 4xx em relação ao todo; Latencia média; Avalie o que mais é relevante para um status-page pessoal do usuario.

---
feat: separe os indicadores por produtos.
Applications: 
    Requests, Average latency, 5xx Error rate,  4xx Error rate
Firewalls:
    WAF Allowed, WAF Blocked threats,
Cache:
    DataTransfer, Cache hit ratio, Tiered Cache DataTransfer, Tiered hit ratio
Functions:
    Function Invocations (in Firewalls), Function Invocations (in Applications)
Image Processor:
    Requests, Bandwidth, Saved Bandwidth
Connector:
    Origin error rate

Remova o chart com todas classes de status.

---
feat: adicione uma consulta ao https://status.azion.com/ que é o status-page da infra geral da Azion e caso tenha algum incidente/manutenção aberto, informe-o nesta pagina no topo. Crie também aqueles graficos exibindo os dias verdes, amarelos e vermelhos conforme os Past Incidents.